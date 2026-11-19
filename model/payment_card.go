package model

import (
	"errors"
	"math/rand/v2"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// PaymentCard is one card in the pool the product fulfiller pays with. The
// card can come from any issuer or virtual-card service; the fulfiller only
// sees the card it is handed for a job.
//
// The number and CVC are stored encrypted with CONFIG_ENCRYPTION_KEY and are
// never returned by the API. NumberFingerprint is a keyed hash that rejects
// duplicates without keeping the number itself.
type PaymentCard struct {
	Id                int    `json:"id"`
	Label             string `json:"label" gorm:"type:varchar(64)"`
	Provider          string `json:"provider" gorm:"type:varchar(16)"`
	Brand             string `json:"brand" gorm:"type:varchar(16)"`
	Last4             string `json:"last4" gorm:"type:varchar(4)"`
	NumberFingerprint string `json:"-" gorm:"type:varchar(64);uniqueIndex"`
	NumberEncrypted   string `json:"-" gorm:"type:text"`
	CVCEncrypted      string `json:"-" gorm:"type:text"`
	ExpiryMonth       int    `json:"expiry_month"`
	ExpiryYear        int    `json:"expiry_year"`
	Holder            string `json:"holder" gorm:"type:varchar(128)"`
	Enabled           bool   `json:"enabled"`
	Priority          int    `json:"priority" gorm:"index"`
	DisabledReason    string `json:"disabled_reason" gorm:"type:varchar(16)"`
	// LeasedAttemptId is the payment attempt that holds the card right now;
	// one card pays for one order at a time.
	LeasedAttemptId int   `json:"leased_attempt_id" gorm:"index"`
	LeasedAt        int64 `json:"leased_at"`
	LastUsedAt      int64 `json:"last_used_at"`
	SuccessCount    int   `json:"success_count"`
	FailCount       int   `json:"fail_count"`
	CreatedAt       int64 `json:"created_at"`
	UpdatedAt       int64 `json:"updated_at"`
}

const (
	PaymentCardStatusReady    = "ready"
	PaymentCardStatusInUse    = "in_use"
	PaymentCardStatusDisabled = "disabled"
	PaymentCardStatusExpired  = "expired"

	PaymentCardDisabledManual   = "manual"
	PaymentCardDisabledDeclined = "declined"

	// Outcomes the fulfiller reports for the card of a finished purchase.
	PaymentCardOutcomeSuccess           = "success"
	PaymentCardOutcomeDeclined          = "declined"
	PaymentCardOutcomeNeedsVerification = "needs_verification"
)

var (
	// ErrPaymentCardDuplicate means the number is already in the pool.
	ErrPaymentCardDuplicate = errors.New("This card is already in the pool")
	// ErrPaymentCardUnavailable means no card matches the request right now.
	ErrPaymentCardUnavailable = errors.New("This card cannot be used right now")
	// ErrPaymentCardInUse means the card is paying for an order right now.
	ErrPaymentCardInUse = errors.New("This card is paying for an order right now")
)

// expiryKey orders cards by expiry: year*100 + month.
func (c PaymentCard) expiryKey() int {
	return c.ExpiryYear*100 + c.ExpiryMonth
}

// Status describes whether the card can pay now. A card past its expiry month
// is expired whatever its switch says.
func (c PaymentCard) Status(now time.Time) string {
	if c.expiryKey() < now.Year()*100+int(now.Month()) {
		return PaymentCardStatusExpired
	}
	if !c.Enabled {
		return PaymentCardStatusDisabled
	}
	if c.LeasedAttemptId != 0 {
		return PaymentCardStatusInUse
	}
	return PaymentCardStatusReady
}

// Snapshot is the label shown on payment records, e.g. "DogPay #1 •••• 4242".
func (c PaymentCard) Snapshot() string {
	return c.Label + " •••• " + c.Last4
}

func ListPaymentCards() ([]PaymentCard, error) {
	var cards []PaymentCard
	err := DB.Order("priority asc, id asc").Find(&cards).Error
	return cards, err
}

func GetPaymentCard(id int) (*PaymentCard, error) {
	var card PaymentCard
	if err := DB.First(&card, id).Error; err != nil {
		return nil, err
	}
	return &card, nil
}

// CountPaymentCards returns how many cards the pool holds.
func CountPaymentCards() (int64, error) {
	var count int64
	err := DB.Model(&PaymentCard{}).Count(&count).Error
	return count, err
}

// PaymentCardExists reports whether a card with this number fingerprint,
// other than exceptId, is already in the pool.
func PaymentCardExists(fingerprint string, exceptId int) (bool, error) {
	var count int64
	err := DB.Model(&PaymentCard{}).Where("number_fingerprint = ? AND id <> ?", fingerprint, exceptId).Count(&count).Error
	return count > 0, err
}

func CreatePaymentCard(card *PaymentCard) error {
	now := common.GetTimestamp()
	card.CreatedAt = now
	card.UpdatedAt = now
	err := DB.Create(card).Error
	if err != nil && isUniqueViolation(err) {
		return ErrPaymentCardDuplicate
	}
	return err
}

// UpdatePaymentCard writes the given columns of card id.
func UpdatePaymentCard(id int, updates map[string]any) error {
	updates["updated_at"] = common.GetTimestamp()
	err := DB.Model(&PaymentCard{}).Where("id = ?", id).Updates(updates).Error
	if err != nil && isUniqueViolation(err) {
		return ErrPaymentCardDuplicate
	}
	return err
}

// DeletePaymentCard removes a card that is not paying for an order right now.
// Payment records keep the card's label and last four digits as a snapshot.
func DeletePaymentCard(id int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var card PaymentCard
		if err := lockForUpdate(tx).First(&card, id).Error; err != nil {
			return err
		}
		if card.LeasedAttemptId != 0 {
			return ErrPaymentCardInUse
		}
		return tx.Delete(&PaymentCard{}, id).Error
	})
}

// LeasePaymentCard picks the card that pays for attemptId and marks it busy
// until the attempt ends. preferredId 0 means a random usable card. The chosen
// card is recorded on the attempt. Cards that are disabled, expired or in use
// are skipped; a preferred card that cannot be used returns
// ErrPaymentCardUnavailable.
func LeasePaymentCard(attemptId int, preferredId int, now time.Time) (*PaymentCard, error) {
	var leased *PaymentCard
	err := DB.Transaction(func(tx *gorm.DB) error {
		query := lockForUpdate(tx).Where("enabled = ? AND leased_attempt_id = ? AND (expiry_year * 100 + expiry_month) >= ?",
			true, 0, now.Year()*100+int(now.Month()))
		if preferredId > 0 {
			query = query.Where("id = ?", preferredId)
		}
		var candidates []PaymentCard
		if err := query.Order("id asc").Find(&candidates).Error; err != nil {
			return err
		}
		if len(candidates) == 0 {
			return ErrPaymentCardUnavailable
		}
		card := candidates[rand.IntN(len(candidates))]
		nowUnix := common.GetTimestamp()
		card.LeasedAttemptId = attemptId
		card.LeasedAt = nowUnix
		card.LastUsedAt = nowUnix
		card.UpdatedAt = nowUnix
		if err := tx.Model(&PaymentCard{}).Where("id = ?", card.Id).Updates(map[string]any{
			"leased_attempt_id": attemptId,
			"leased_at":         nowUnix,
			"last_used_at":      nowUnix,
			"updated_at":        nowUnix,
		}).Error; err != nil {
			return err
		}
		if err := tx.Model(&ProductFulfillmentAttempt{}).Where("id = ?", attemptId).Updates(map[string]any{
			"payment_card_id":    card.Id,
			"payment_card_label": card.Snapshot(),
		}).Error; err != nil {
			return err
		}
		leased = &card
		return nil
	})
	return leased, err
}

// releasePaymentCardLeases frees the cards held by attemptId. It runs in the
// transaction that ends the attempt.
func releasePaymentCardLeases(tx *gorm.DB, attemptId int) error {
	return tx.Model(&PaymentCard{}).Where("leased_attempt_id = ?", attemptId).Update("leased_attempt_id", 0).Error
}

// ReleaseStalePaymentCardLeases frees cards whose attempt is no longer running,
// for example after a restart interrupted a purchase.
func ReleaseStalePaymentCardLeases() error {
	return DB.Model(&PaymentCard{}).
		Where("leased_attempt_id <> ? AND leased_attempt_id NOT IN (?)", 0,
			DB.Model(&ProductFulfillmentAttempt{}).Select("id").Where("status = ?", ProductFulfillmentRunning)).
		Update("leased_attempt_id", 0).Error
}

// RecordPaymentCardOutcome counts the fulfiller's result for the card of
// attemptId. A declined card is disabled so it is not tried again until an
// admin re-enables it.
func RecordPaymentCardOutcome(attemptId int, outcome string) error {
	var attempt ProductFulfillmentAttempt
	if err := DB.Select("id", "payment_card_id").First(&attempt, attemptId).Error; err != nil {
		return err
	}
	if attempt.PaymentCardId == 0 {
		return nil
	}
	updates := map[string]any{"updated_at": common.GetTimestamp()}
	switch outcome {
	case PaymentCardOutcomeSuccess:
		updates["success_count"] = gorm.Expr("success_count + 1")
	case PaymentCardOutcomeDeclined:
		updates["fail_count"] = gorm.Expr("fail_count + 1")
		updates["enabled"] = false
		updates["disabled_reason"] = PaymentCardDisabledDeclined
	default:
		// needs_verification and unknown outcomes: the card is not at fault.
		return nil
	}
	return DB.Model(&PaymentCard{}).Where("id = ?", attempt.PaymentCardId).Updates(updates).Error
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return strings.Contains(message, "UNIQUE constraint failed") ||
		strings.Contains(message, "Duplicate entry") ||
		strings.Contains(message, "duplicate key value")
}
