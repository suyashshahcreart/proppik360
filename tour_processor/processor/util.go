package processor

import "os"

func removeFileSafe(path string) error {
	return os.Remove(path)
}
