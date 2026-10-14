package processor

import (
	"archive/zip"
	"path/filepath"
	"strings"
)

// Format identifies the 360° tour format inside a ZIP.
type Format int

const (
	FormatPSV      Format = iota // Photo Sphere Viewer — index.html + virtual-tour-nodes.json
	FormatMakeBook               // MakeBook export — different entry structure
	FormatUnknown                // Unrecognized — still extracted but viewer URL may not work
)

func (f Format) String() string {
	switch f {
	case FormatPSV:
		return "PSV"
	case FormatMakeBook:
		return "MakeBook"
	default:
		return "Unknown"
	}
}

// DetectFormat inspects ZIP file entries to determine the tour format.
// It looks for known marker files without extracting any content.
func DetectFormat(files []*zip.File) Format {
	var names []string
	for _, f := range files {
		names = append(names, filepath.ToSlash(f.Name))
	}

	hasPSVNodes := hasFile(names, "virtual-tour-nodes.json")
	hasIndexHTML := hasFileInRoot(names, "index.html")
	hasMakeBook := containsAny(names, "makebook", "mb_")

	switch {
	case hasIndexHTML && hasPSVNodes:
		return FormatPSV
	case hasMakeBook:
		return FormatMakeBook
	case hasIndexHTML:
		// index.html exists but no nodes file — treat as PSV-compatible
		return FormatPSV
	default:
		return FormatUnknown
	}
}

// EntryPointFile returns the main HTML file name for the given format.
// This is used to build the viewer URL after extraction.
func EntryPointFile(format Format) string {
	switch format {
	case FormatMakeBook:
		return "index.html" // MakeBook also uses index.html typically
	default:
		return "index.html"
	}
}

func hasFile(names []string, target string) bool {
	for _, n := range names {
		if strings.EqualFold(filepath.Base(n), target) {
			return true
		}
	}
	return false
}

// hasFileInRoot checks if the file exists directly in the ZIP root or
// one level deep (some exporters wrap everything in a single folder).
func hasFileInRoot(names []string, target string) bool {
	for _, n := range names {
		parts := strings.Split(filepath.ToSlash(n), "/")
		// root: "index.html"  OR one folder deep: "TourName/index.html"
		if len(parts) <= 2 && strings.EqualFold(parts[len(parts)-1], target) {
			return true
		}
	}
	return false
}

func containsAny(names []string, keywords ...string) bool {
	for _, n := range names {
		lower := strings.ToLower(n)
		for _, kw := range keywords {
			if strings.Contains(lower, kw) {
				return true
			}
		}
	}
	return false
}

// StripTopLevelFolder removes the common top-level folder prefix from a ZIP entry path.
// For example, if all files are under "Avadhgreens/", the prefix is stripped so
// the output path in R2 is "tiles/..." not "Avadhgreens/tiles/...".
func StripTopLevelFolder(files []*zip.File) string {
	if len(files) == 0 {
		return ""
	}

	// Find the common prefix of all file paths
	first := filepath.ToSlash(files[0].Name)
	parts := strings.SplitN(first, "/", 2)
	if len(parts) < 2 {
		return "" // files are already in root, no stripping needed
	}
	prefix := parts[0] + "/"

	for _, f := range files {
		name := filepath.ToSlash(f.Name)
		if !strings.HasPrefix(name, prefix) {
			return "" // not all files share the same prefix
		}
	}

	return prefix // e.g. "Avadhgreens/"
}
