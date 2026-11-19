package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

// PaymentCardProviders are the sources a pooled card can come from. The
// fulfiller does not treat them differently; they are labels for admins.
var PaymentCardProviders = []string{"dogpay", "virtual", "physical", "other"}

const (
	paymentCardLabelMaxLength  = 64
	paymentCardHolderMaxLength = 128
	// paymentCardFingerprintPurpose keys the duplicate check so the stored
	// fingerprint is not a plain hash of the card number.
	paymentCardFingerprintPurpose = "ez-ai-payment-card-fingerprint-v1"
)

var (
	ErrPaymentCardInvalidNumber = errors.New("The card number must be 12-19 digits")
	ErrPaymentCardInvalidExpiry = errors.New("The card expiry must look like MM/YY")
	ErrPaymentCardInvalidCVC    = errors.New("The CVC must be 3-4 digits")
	ErrPaymentCardInvalidLabel  = errors.New("The label is required and at most 64 characters")
	ErrPaymentCardInvalidHolder = errors.New("The card holder is required and at most 128 characters")
	ErrPaymentCardInvalidSource = errors.New("The provider must be dogpay, virtual, physical or other")
)

var (
	paymentCardNumberPattern = regexp.MustCompile(`^\d{12,19}$`)
	paymentCardExpiryPattern = regexp.MustCompile(`^(0[1-9]|1[0-2])/(\d{2})$`)
	paymentCardCVCPattern    = regexp.MustCompile(`^\d{3,4}$`)
)

// PaymentCardInput is what the admin sends for a pooled card. On create every
// field except Priority and Enabled is required; on update a nil field is
// left as it is, and Number and CVC are only replaced when given.
type PaymentCardInput struct {
	Label    *string `json:"label"`
	Provider *string `json:"provider"`
	Number   *string `json:"number"`
	Expiry   *string `json:"expiry"`
	CVC      *string `json:"cvc"`
	Holder   *string `json:"holder"`
	Priority *int    `json:"priority"`
	Enabled  *bool   `json:"enabled"`
}

// CreatePaymentCard validates the input and stores a new card in the pool.
func CreatePaymentCard(input PaymentCardInput) (*model.PaymentCard, error) {
	if !common.ConfigEncryptionReady() {
		return nil, common.ErrConfigEncryptionKeyMissing
	}
	card := &model.PaymentCard{Provider: "other"}
	if input.Provider != nil {
		card.Provider = strings.TrimSpace(*input.Provider)
	}
	if input.Priority != nil {
		card.Priority = *input.Priority
	}
	if input.Enabled != nil {
		card.Enabled = *input.Enabled
	}
	if err := applyPaymentCardFields(card, input, true); err != nil {
		return nil, err
	}
	if err := model.CreatePaymentCard(card); err != nil {
		return nil, err
	}
	return card, nil
}

// UpdatePaymentCard applies the given fields to card id. Enabling a card
// clears the reason it was disabled for; switching it off by hand records
// that the admin did it.
func UpdatePaymentCard(id int, input PaymentCardInput) (*model.PaymentCard, error) {
	current, err := model.GetPaymentCard(id)
	if err != nil {
		return nil, err
	}
	updates := map[string]any{}
	if input.Priority != nil {
		updates["priority"] = *input.Priority
	}
	if input.Enabled != nil {
		updates["enabled"] = *input.Enabled
		updates["disabled_reason"] = ""
		if !*input.Enabled {
			updates["disabled_reason"] = model.PaymentCardDisabledManual
		}
	}
	card := *current
	if err := applyPaymentCardFields(&card, input, false); err != nil {
		return nil, err
	}
	if input.Provider != nil {
		updates["provider"] = card.Provider
	}
	if input.Label != nil {
		updates["label"] = card.Label
	}
	if input.Holder != nil {
		updates["holder"] = card.Holder
	}
	if input.Expiry != nil {
		updates["expiry_month"] = card.ExpiryMonth
		updates["expiry_year"] = card.ExpiryYear
	}
	if input.Number != nil {
		exists, err := model.PaymentCardExists(card.NumberFingerprint, id)
		if err != nil {
			return nil, err
		}
		if exists {
			return nil, model.ErrPaymentCardDuplicate
		}
		updates["number_fingerprint"] = card.NumberFingerprint
		updates["number_encrypted"] = card.NumberEncrypted
		updates["brand"] = card.Brand
		updates["last4"] = card.Last4
	}
	if input.CVC != nil {
		updates["cvc_encrypted"] = card.CVCEncrypted
	}
	if len(updates) > 0 {
		if err := model.UpdatePaymentCard(id, updates); err != nil {
			return nil, err
		}
	}
	return model.GetPaymentCard(id)
}

// applyPaymentCardFields validates the input and writes it to card. On create
// every secret and label field must be present; on update only the fields
// the input carries are checked and changed.
func applyPaymentCardFields(card *model.PaymentCard, input PaymentCardInput, creating bool) error {
	if input.Label != nil || creating {
		label := strings.TrimSpace(stringOrEmpty(input.Label))
		if label == "" || len([]rune(label)) > paymentCardLabelMaxLength {
			return ErrPaymentCardInvalidLabel
		}
		card.Label = label
	}
	if input.Provider != nil {
		provider := strings.TrimSpace(*input.Provider)
		if !slices.Contains(PaymentCardProviders, provider) {
			return ErrPaymentCardInvalidSource
		}
		card.Provider = provider
	}
	if input.Holder != nil || creating {
		holder := strings.TrimSpace(stringOrEmpty(input.Holder))
		if holder == "" || len([]rune(holder)) > paymentCardHolderMaxLength {
			return ErrPaymentCardInvalidHolder
		}
		card.Holder = holder
	}
	if input.Expiry != nil || creating {
		if err := setPaymentCardExpiry(card, stringOrEmpty(input.Expiry)); err != nil {
			return err
		}
	}
	if input.Number != nil || creating {
		if err := setPaymentCardNumber(card, stringOrEmpty(input.Number)); err != nil {
			return err
		}
	}
	if input.CVC != nil || creating {
		cvc := strings.TrimSpace(stringOrEmpty(input.CVC))
		if !paymentCardCVCPattern.MatchString(cvc) {
			return ErrPaymentCardInvalidCVC
		}
		encrypted, err := common.EncryptConfigValue([]byte(cvc))
		if err != nil {
			return err
		}
		card.CVCEncrypted = encrypted
	}
	return nil
}

func setPaymentCardExpiry(card *model.PaymentCard, value string) error {
	match := paymentCardExpiryPattern.FindStringSubmatch(strings.TrimSpace(value))
	if match == nil {
		return ErrPaymentCardInvalidExpiry
	}
	month, _ := strconv.Atoi(match[1])
	year, _ := strconv.Atoi(match[2])
	card.ExpiryMonth = month
	card.ExpiryYear = 2000 + year
	return nil
}

func setPaymentCardNumber(card *model.PaymentCard, value string) error {
	number := strings.NewReplacer(" ", "", "-", "").Replace(strings.TrimSpace(value))
	if !paymentCardNumberPattern.MatchString(number) {
		return ErrPaymentCardInvalidNumber
	}
	encrypted, err := common.EncryptConfigValue([]byte(number))
	if err != nil {
		return err
	}
	card.NumberEncrypted = encrypted
	card.NumberFingerprint = paymentCardFingerprint(number)
	card.Brand = PaymentCardBrand(number)
	card.Last4 = number[len(number)-4:]
	return nil
}

// paymentCardFingerprint is a keyed hash of the card number, stable across
// restarts while CONFIG_ENCRYPTION_KEY stays the same.
func paymentCardFingerprint(number string) string {
	mac := hmac.New(sha256.New, common.DeriveAESKey(paymentCardFingerprintPurpose, common.ConfigEncryptionKey))
	mac.Write([]byte(number))
	return hex.EncodeToString(mac.Sum(nil))
}

// PaymentCardBrand names the network from the leading digits, or "" when it
// is not one of the common ones.
func PaymentCardBrand(number string) string {
	switch {
	case strings.HasPrefix(number, "4"):
		return "visa"
	case strings.HasPrefix(number, "34"), strings.HasPrefix(number, "37"):
		return "amex"
	case isMastercardPrefix(number):
		return "mastercard"
	case strings.HasPrefix(number, "62"):
		return "unionpay"
	case strings.HasPrefix(number, "35"):
		return "jcb"
	case strings.HasPrefix(number, "6011"), strings.HasPrefix(number, "65"):
		return "discover"
	}
	return ""
}

func isMastercardPrefix(number string) bool {
	if len(number) < 2 {
		return false
	}
	two, _ := strconv.Atoi(number[:2])
	if two >= 51 && two <= 55 {
		return true
	}
	if len(number) < 4 {
		return false
	}
	four, _ := strconv.Atoi(number[:4])
	return four >= 2221 && four <= 2720
}

// DecryptPaymentCard returns the card as the fulfiller job carries it.
func DecryptPaymentCard(card *model.PaymentCard) (ProductFulfillerCard, error) {
	number, err := common.DecryptConfigValue(card.NumberEncrypted)
	if err != nil {
		return ProductFulfillerCard{}, err
	}
	cvc, err := common.DecryptConfigValue(card.CVCEncrypted)
	if err != nil {
		return ProductFulfillerCard{}, err
	}
	return ProductFulfillerCard{
		Number: string(number),
		Expiry: formatPaymentCardExpiry(card.ExpiryMonth, card.ExpiryYear),
		CVC:    string(cvc),
		Holder: card.Holder,
	}, nil
}

func formatPaymentCardExpiry(month, year int) string {
	return fmt.Sprintf("%02d/%02d", month, year%100)
}

// ImportLegacyProductFulfillerCard moves the single card that the settings
// used to hold into the pool, then removes it from the settings. Running it
// again is harmless: once the card is out of the settings there is nothing to
// import, and a card already in the pool is not added twice.
func ImportLegacyProductFulfillerCard() error {
	stored := system_setting.ProductFulfillerConfig
	if stored == "" || !common.ConfigEncryptionReady() {
		return nil
	}
	plaintext, err := common.DecryptConfigValue(stored)
	if err != nil {
		return err
	}
	var legacy struct {
		Card ProductFulfillerCard `json:"card"`
	}
	if err := common.Unmarshal(plaintext, &legacy); err != nil {
		return err
	}
	if legacy.Card.Number == "" {
		return nil
	}
	if err := importLegacyCard(legacy.Card); err != nil {
		return err
	}
	var config ProductFulfillerConfig
	if err := common.Unmarshal(plaintext, &config); err != nil {
		return err
	}
	return SaveProductFulfillerConfig(config)
}

func importLegacyCard(card ProductFulfillerCard) error {
	_, err := CreatePaymentCard(PaymentCardInput{
		Label:    stringPointer("DogPay"),
		Provider: stringPointer("dogpay"),
		Number:   stringPointer(card.Number),
		Expiry:   stringPointer(card.Expiry),
		CVC:      stringPointer(card.CVC),
		Holder:   stringPointer(card.Holder),
		Enabled:  boolPointer(true),
	})
	if errors.Is(err, model.ErrPaymentCardDuplicate) {
		return nil
	}
	return err
}

func stringOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func stringPointer(value string) *string { return &value }

func boolPointer(value bool) *bool { return &value }
