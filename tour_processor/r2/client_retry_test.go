package r2

import "testing"

func TestIsTransientNetErr(t *testing.T) {
	cases := []struct {
		msg  string
		want bool
	}{
		{"dial tcp: lookup foo.r2.cloudflarestorage.com: no such host", true},
		{"Get \"https://x\": dial tcp: lookup x: no such host", true},
		{"connection reset by peer", true},
		{"tls: handshake timeout", true},
		{"AccessDenied: forbidden", false},
		{"NoSuchKey", false},
		{"", false},
	}
	for _, tc := range cases {
		err := error(nil)
		if tc.msg != "" {
			err = &simpleErr{tc.msg}
		}
		if got := isTransientNetErr(err); got != tc.want {
			t.Fatalf("%q: got %v want %v", tc.msg, got, tc.want)
		}
	}
}

type simpleErr struct{ s string }

func (e *simpleErr) Error() string { return e.s }
