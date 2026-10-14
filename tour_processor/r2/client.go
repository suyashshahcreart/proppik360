// Package r2 provides R2 S3-compatible upload operations using aws-sdk-go-v2.
// Supports both single PUT (for small files) and multipart upload (for large files).
package r2

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// Config holds R2 connection details.
type Config struct {
	AccountID       string
	BucketName      string
	AccessKeyID     string
	SecretAccessKey string
}

// Client wraps the S3 client configured for Cloudflare R2.
type Client struct {
	s3     *s3.Client
	bucket string
}

const (
	// apiRetries covers transient DNS / dial / TLS blips that used to fail
	// LoadManifest (GetObject) hard — uploads already retry at the pool layer.
	apiRetries     = 5
	apiRetryBaseMs = 250
)

// New creates a new R2 Client using the S3-compatible endpoint.
func New(cfg Config) *Client {
	endpoint := fmt.Sprintf("https://%s.r2.cloudflarestorage.com", cfg.AccountID)

	s3Client := s3.New(s3.Options{
		Region:       "auto",
		BaseEndpoint: aws.String(endpoint),
		Credentials: credentials.NewStaticCredentialsProvider(
			cfg.AccessKeyID,
			cfg.SecretAccessKey,
			"",
		),
		UsePathStyle: true,
		HTTPClient:   newTunedHTTPClient(),

		// Skip the SDK's default per-request CRC32 checksum computation
		// (added as the default in aws-sdk-go-v2 s3 v1.74.1+). At 100K+
		// tiny-file volume this is a meaningful, free CPU saving; R2 still
		// validates integrity via ETag/MD5 on every PUT regardless.
		RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired,
		ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired,
	})

	return &Client{s3: s3Client, bucket: cfg.BucketName}
}

// newTunedHTTPClient builds an *http.Client with connection-pool settings
// suited to many-small-file, high-concurrency uploads to a SINGLE host
// (R2's S3-compatible endpoint). The SDK's default transport caps idle
// connections per host fairly low, which forces repeated TCP+TLS handshakes
// once concurrency climbs into the hundreds — expensive when most requests
// are tiny PUTs. MaxConnsPerHost is left at 0 (unlimited): the real
// concurrency throttle is the global upload semaphore in the processor
// package, not the HTTP transport.
//
// Dial uses tcp4 deliberately: on Windows, intermittent IPv6 / router DNS
// failures (lookup … no such host) were failing GetObject for .manifest.json
// even though the account endpoint is valid and IPv4 resolves fine.
func newTunedHTTPClient() *http.Client {
	dialer := &net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
	}
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: func(ctx context.Context, _, addr string) (net.Conn, error) {
			return dialer.DialContext(ctx, "tcp4", addr)
		},
		MaxIdleConns:          512,
		MaxIdleConnsPerHost:   512,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   15 * time.Second,
		ResponseHeaderTimeout: 60 * time.Second,
		ExpectContinueTimeout: 2 * time.Second,
		ForceAttemptHTTP2:     true,
	}
	return &http.Client{
		Transport: transport,
		Timeout:   5 * time.Minute, // generous ceiling; individual small PUTs finish in milliseconds
	}
}

func isTransientNetErr(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	for _, needle := range []string{
		"no such host",
		"temporary failure",
		"server misbehaving",
		"i/o timeout",
		"timeout",
		"connection reset",
		"connection refused",
		"connection aborted",
		"broken pipe",
		"tls handshake timeout",
		"http2: client connection lost",
		"use of closed network connection",
		"unexpected eof",
		"wsarecv",
		"wsasend",
	} {
		if strings.Contains(msg, needle) {
			return true
		}
	}
	return false
}

func withRetry(ctx context.Context, op string, fn func() error) error {
	var last error
	for attempt := 1; attempt <= apiRetries; attempt++ {
		last = fn()
		if last == nil {
			return nil
		}
		if !isTransientNetErr(last) || attempt == apiRetries {
			return last
		}
		backoff := time.Duration(attempt*attempt*apiRetryBaseMs) * time.Millisecond
		log.Printf("[r2] retry %d/%d %s after %s: %v", attempt, apiRetries, op, backoff, last)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
	}
	return last
}

// PutObject uploads data as a single PUT request.
// Suitable for files under ~5 MB (or any file when called from uploader).
func (c *Client) PutObject(ctx context.Context, key string, data []byte) error {
	contentType := detectContentType(key)

	return withRetry(ctx, "PutObject "+key, func() error {
		_, err := c.s3.PutObject(ctx, &s3.PutObjectInput{
			Bucket:      aws.String(c.bucket),
			Key:         aws.String(key),
			Body:        bytes.NewReader(data),
			ContentType: aws.String(contentType),
		})
		if err != nil {
			return fmt.Errorf("PutObject %s: %w", key, err)
		}
		return nil
	})
}

// UploadMultipart uploads a large file using S3 multipart upload protocol.
// partSize controls how large each part is (minimum 5 MiB per S3/R2 spec).
// The reader must be seekable (i.e. an *os.File from disk).
func (c *Client) UploadMultipart(ctx context.Context, key string, r io.ReadSeeker, totalSize int64, partSizeBytes int64) error {
	contentType := detectContentType(key)

	// 1. Create multipart upload session
	createResp, err := c.s3.CreateMultipartUpload(ctx, &s3.CreateMultipartUploadInput{
		Bucket:      aws.String(c.bucket),
		Key:         aws.String(key),
		ContentType: aws.String(contentType),
	})
	if err != nil {
		return fmt.Errorf("CreateMultipartUpload %s: %w", key, err)
	}
	uploadID := aws.ToString(createResp.UploadId)

	// Abort on any failure so we don't leave orphaned multipart sessions
	var completedParts []types.CompletedPart
	abort := func() {
		_, _ = c.s3.AbortMultipartUpload(ctx, &s3.AbortMultipartUploadInput{
			Bucket:   aws.String(c.bucket),
			Key:      aws.String(key),
			UploadId: aws.String(uploadID),
		})
	}

	// 2. Upload parts
	buf := make([]byte, partSizeBytes)
	partNumber := int32(1)

	for {
		n, readErr := io.ReadFull(r, buf)
		if n == 0 {
			break
		}
		if readErr != nil && readErr != io.ErrUnexpectedEOF {
			abort()
			return fmt.Errorf("read part %d: %w", partNumber, readErr)
		}

		partData := buf[:n]

		uploadResp, err := c.s3.UploadPart(ctx, &s3.UploadPartInput{
			Bucket:     aws.String(c.bucket),
			Key:        aws.String(key),
			UploadId:   aws.String(uploadID),
			PartNumber: aws.Int32(partNumber),
			Body:       bytes.NewReader(partData),
		})
		if err != nil {
			abort()
			return fmt.Errorf("UploadPart %d for %s: %w", partNumber, key, err)
		}

		completedParts = append(completedParts, types.CompletedPart{
			ETag:       uploadResp.ETag,
			PartNumber: aws.Int32(partNumber),
		})

		partNumber++

		// Last chunk was smaller than buffer — we're done
		if readErr == io.ErrUnexpectedEOF {
			break
		}
	}

	// Sort parts ascending by part number (R2/S3 requirement)
	sort.Slice(completedParts, func(i, j int) bool {
		return aws.ToInt32(completedParts[i].PartNumber) < aws.ToInt32(completedParts[j].PartNumber)
	})

	// 3. Complete
	_, err = c.s3.CompleteMultipartUpload(ctx, &s3.CompleteMultipartUploadInput{
		Bucket:   aws.String(c.bucket),
		Key:      aws.String(key),
		UploadId: aws.String(uploadID),
		MultipartUpload: &types.CompletedMultipartUpload{
			Parts: completedParts,
		},
	})
	if err != nil {
		abort()
		return fmt.Errorf("CompleteMultipartUpload %s: %w", key, err)
	}

	return nil
}

// HeadObject returns size and etag. exists is false when the key is missing.
func (c *Client) HeadObject(ctx context.Context, key string) (size int64, etag string, exists bool, err error) {
	err = withRetry(ctx, "HeadObject "+key, func() error {
		out, headErr := c.s3.HeadObject(ctx, &s3.HeadObjectInput{
			Bucket: aws.String(c.bucket),
			Key:    aws.String(key),
		})
		if headErr != nil {
			msg := headErr.Error()
			if strings.Contains(msg, "NotFound") || strings.Contains(msg, "404") || strings.Contains(msg, "NoSuchKey") {
				size, etag, exists = 0, "", false
				return nil
			}
			return fmt.Errorf("HeadObject %s: %w", key, headErr)
		}
		etag = strings.Trim(aws.ToString(out.ETag), `"`)
		size = aws.ToInt64(out.ContentLength)
		exists = true
		return nil
	})
	return size, etag, exists, err
}

// GetObject downloads an object. exists is false on 404.
func (c *Client) GetObject(ctx context.Context, key string) (data []byte, exists bool, err error) {
	err = withRetry(ctx, "GetObject "+key, func() error {
		out, getErr := c.s3.GetObject(ctx, &s3.GetObjectInput{
			Bucket: aws.String(c.bucket),
			Key:    aws.String(key),
		})
		if getErr != nil {
			msg := getErr.Error()
			if strings.Contains(msg, "NotFound") || strings.Contains(msg, "404") || strings.Contains(msg, "NoSuchKey") {
				data, exists = nil, false
				return nil
			}
			return fmt.Errorf("GetObject %s: %w", key, getErr)
		}
		defer out.Body.Close()
		body, readErr := io.ReadAll(out.Body)
		if readErr != nil {
			return readErr
		}
		data, exists = body, true
		return nil
	})
	return data, exists, err
}

// detectContentType returns an appropriate Content-Type based on file extension.
func detectContentType(key string) string {
	ext := strings.ToLower(filepath.Ext(key))

	// Common 360° tour file types not always in the default MIME database
	switch ext {
	case ".webp":
		return "image/webp"
	case ".avif":
		return "image/avif"
	case ".glb":
		return "model/gltf-binary"
	case ".gltf":
		return "model/gltf+json"
	case ".json":
		return "application/json"
	case ".xml":
		return "application/xml"
	case ".m3u8":
		return "application/vnd.apple.mpegurl"
	case ".ts":
		return "video/mp2t"
	}

	if t := mime.TypeByExtension(ext); t != "" {
		return t
	}
	return "application/octet-stream"
}
