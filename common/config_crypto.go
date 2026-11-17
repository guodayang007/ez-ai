package common

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
)

// ConfigEncryptionKey encrypts settings stored in the options table that hold
// secrets, such as the product fulfiller's payment card. It is read from
// CONFIG_ENCRYPTION_KEY and must stay the same across restarts: values saved
// under one key cannot be read with another.
var ConfigEncryptionKey = ""

// ConfigEncryptionKeyMinLength is the shortest CONFIG_ENCRYPTION_KEY accepted.
const ConfigEncryptionKeyMinLength = 32

const configCipherPrefix = "enc:v1:"

var (
	ErrConfigEncryptionKeyMissing = errors.New("CONFIG_ENCRYPTION_KEY is not set or shorter than 32 characters")
	ErrConfigDecryptFailed        = errors.New("stored setting cannot be decrypted with the current CONFIG_ENCRYPTION_KEY")
)

// ConfigEncryptionReady reports whether encrypted settings can be saved and read.
func ConfigEncryptionReady() bool {
	return len(ConfigEncryptionKey) >= ConfigEncryptionKeyMinLength
}

// EncryptConfigValue seals plaintext with AES-256-GCM under a key derived
// from CONFIG_ENCRYPTION_KEY. The result is text safe to store in options.
func EncryptConfigValue(plaintext []byte) (string, error) {
	if !ConfigEncryptionReady() {
		return "", ErrConfigEncryptionKeyMissing
	}
	sealed, err := SealAESGCM(DeriveAESKey("ez-ai-config-v1", ConfigEncryptionKey), plaintext)
	if err != nil {
		return "", err
	}
	return configCipherPrefix + base64.StdEncoding.EncodeToString(sealed), nil
}

// DecryptConfigValue opens a value written by EncryptConfigValue.
func DecryptConfigValue(value string) ([]byte, error) {
	if !ConfigEncryptionReady() {
		return nil, ErrConfigEncryptionKeyMissing
	}
	encoded, ok := strings.CutPrefix(value, configCipherPrefix)
	if !ok {
		return nil, ErrConfigDecryptFailed
	}
	sealed, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, ErrConfigDecryptFailed
	}
	plaintext, err := OpenAESGCM(DeriveAESKey("ez-ai-config-v1", ConfigEncryptionKey), sealed)
	if err != nil {
		return nil, ErrConfigDecryptFailed
	}
	return plaintext, nil
}

// DeriveAESKey turns a secret into a 256-bit key bound to purpose, so one
// secret never encrypts two kinds of data under the same key.
func DeriveAESKey(purpose, secret string) []byte {
	sum := sha256.Sum256([]byte(purpose + ":" + secret))
	return sum[:]
}

// SealAESGCM encrypts with AES-GCM and returns nonce || ciphertext || tag.
func SealAESGCM(key, plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

// OpenAESGCM decrypts nonce || ciphertext || tag written by SealAESGCM.
func OpenAESGCM(key, sealed []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(sealed) < gcm.NonceSize()+gcm.Overhead() {
		return nil, errors.New("sealed data is too short")
	}
	nonce, ciphertext := sealed[:gcm.NonceSize()], sealed[gcm.NonceSize():]
	return gcm.Open(nil, nonce, ciphertext, nil)
}
