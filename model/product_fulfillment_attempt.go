package model

import (
	"fmt"
	"slices"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// Steps of one "Execute payment" attempt, in the order they run. ez-ai runs
// prepare, submit and complete itself; the fulfiller reports the steps in
// between through signed progress callbacks.
const (
	ProductFulfillmentStepPrepare       = "prepare"
	ProductFulfillmentStepSubmit        = "submit"
	ProductFulfillmentStepQueue         = "queue"
	ProductFulfillmentStepBrowser       = "browser"
	ProductFulfillmentStepSubscription  = "subscription"
	ProductFulfillmentStepCheckout      = "checkout"
	ProductFulfillmentStepFillPayment   = "fill_payment"
	ProductFulfillmentStepSubmitPayment = "submit_payment"
	ProductFulfillmentStepConfirm       = "confirm_payment"
	ProductFulfillmentStepComplete      = "complete"
)

// ProductFulfillmentSteps is the order steps run in; the admin page shows
// them in this order. web/src/features/products/constants.ts mirrors it.
var ProductFulfillmentSteps = []string{
	ProductFulfillmentStepPrepare,
	ProductFulfillmentStepSubmit,
	ProductFulfillmentStepQueue,
	ProductFulfillmentStepBrowser,
	ProductFulfillmentStepSubscription,
	ProductFulfillmentStepCheckout,
	ProductFulfillmentStepFillPayment,
	ProductFulfillmentStepSubmitPayment,
	ProductFulfillmentStepConfirm,
	ProductFulfillmentStepComplete,
}

// States of one step. An event may also be ProductFulfillmentEventInfo: a
// detail logged while its step runs, which leaves the step state alone.
const (
	ProductFulfillmentStepPending   = "pending"
	ProductFulfillmentStepRunning   = "running"
	ProductFulfillmentStepSucceeded = "succeeded"
	ProductFulfillmentStepFailed    = "failed"
	ProductFulfillmentEventInfo     = "info"
)

const (
	productFulfillmentMaxEvents        = 200
	productFulfillmentMaxMessageRunes  = 1000
	productFulfillmentMaxParams        = 10
	productFulfillmentMaxParamRunes    = 500
	productFulfillmentMaxParamKeyBytes = 32
)

// productFulfillmentAttemptMutex serializes event writes in this process.
// The row lock covers several servers on MySQL and PostgreSQL; SQLite has no
// row locks, and there all writes come from this one process.
var productFulfillmentAttemptMutex sync.Mutex

// ProductFulfillmentStepState is where one step of an attempt stands.
// Message is an English message key with {{name}} placeholders filled from
// Params; the admin page translates it.
type ProductFulfillmentStepState struct {
	Key        string            `json:"key"`
	Status     string            `json:"status"`
	StartedAt  int64             `json:"started_at"`
	FinishedAt int64             `json:"finished_at"`
	Message    string            `json:"message"`
	Params     map[string]string `json:"params,omitempty"`
}

// ProductFulfillmentEvent is one line of an attempt's detailed log.
type ProductFulfillmentEvent struct {
	At      int64             `json:"at"`
	Step    string            `json:"step"`
	Status  string            `json:"status"`
	Message string            `json:"message"`
	Params  map[string]string `json:"params,omitempty"`
}

// ProductFulfillmentAttempt records one click on "Execute payment": the plan,
// who started it, how far each step got and every event on the way. An order
// keeps all of its attempts.
type ProductFulfillmentAttempt struct {
	Id           int    `json:"id"`
	OrderId      int    `json:"order_id" gorm:"index"`
	TradeNo      string `json:"trade_no" gorm:"type:varchar(64);index"`
	Plan         string `json:"plan" gorm:"type:varchar(64)"`
	Status       string `json:"status" gorm:"type:varchar(16)"`
	CurrentStep  string `json:"current_step" gorm:"type:varchar(32)"`
	OperatorId   int    `json:"operator_id"`
	OperatorName string `json:"operator_name" gorm:"type:varchar(64)"`
	// PaymentCardId and PaymentCardLabel record the card that paid. The label
	// is a snapshot, so the record still says which card it was after the card
	// is deleted.
	PaymentCardId    int    `json:"card_id" gorm:"index"`
	PaymentCardLabel string `json:"card_label" gorm:"type:varchar(128)"`
	StepsJSON        string `json:"-" gorm:"column:steps;type:text"`
	// Up to productFulfillmentMaxEvents events of up to 1000 characters
	// each, more than a MySQL text column holds.
	EventsJSON LongText `json:"-" gorm:"column:events"`
	StartedAt  int64    `json:"started_at"`
	FinishedAt int64    `json:"finished_at"`
	UpdatedAt  int64    `json:"updated_at"`

	// Seq numbers the attempts of one order from 1, oldest first.
	Seq    int                           `json:"seq" gorm:"-"`
	Steps  []ProductFulfillmentStepState `json:"steps" gorm:"-"`
	Events []ProductFulfillmentEvent     `json:"events" gorm:"-"`
}

func (a *ProductFulfillmentAttempt) decodeJSONColumns() error {
	a.Steps = []ProductFulfillmentStepState{}
	a.Events = []ProductFulfillmentEvent{}
	if strings.TrimSpace(a.StepsJSON) != "" {
		if err := common.UnmarshalJsonStr(a.StepsJSON, &a.Steps); err != nil {
			return err
		}
	}
	if strings.TrimSpace(string(a.EventsJSON)) != "" {
		if err := common.UnmarshalJsonStr(string(a.EventsJSON), &a.Events); err != nil {
			return err
		}
	}
	return nil
}

func (a *ProductFulfillmentAttempt) encodeJSONColumns() error {
	steps, err := common.Marshal(a.Steps)
	if err != nil {
		return err
	}
	events, err := common.Marshal(a.Events)
	if err != nil {
		return err
	}
	a.StepsJSON = string(steps)
	a.EventsJSON = LongText(events)
	return nil
}

// NewProductFulfillmentEvent builds an event with its text cut to the stored
// limits; fulfiller messages can quote whole page errors.
func NewProductFulfillmentEvent(step, status, message string, params map[string]string) ProductFulfillmentEvent {
	event := ProductFulfillmentEvent{
		At:      common.GetTimestamp(),
		Step:    step,
		Status:  status,
		Message: truncateProductRunes(strings.TrimSpace(message), productFulfillmentMaxMessageRunes),
	}
	for key, value := range params {
		if len(event.Params) >= productFulfillmentMaxParams {
			break
		}
		if key == "" || len(key) > productFulfillmentMaxParamKeyBytes {
			continue
		}
		if event.Params == nil {
			event.Params = map[string]string{}
		}
		event.Params[key] = truncateProductRunes(value, productFulfillmentMaxParamRunes)
	}
	return event
}

func truncateProductRunes(value string, max int) string {
	runes := []rune(value)
	if len(runes) <= max {
		return value
	}
	return string(runes[:max])
}

// IsProductFulfillmentEventStatus reports whether status may be sent in a
// progress event.
func IsProductFulfillmentEventStatus(status string) bool {
	switch status {
	case ProductFulfillmentStepRunning, ProductFulfillmentStepSucceeded, ProductFulfillmentStepFailed, ProductFulfillmentEventInfo:
		return true
	}
	return false
}

// applyEvent logs the event and moves the steps forward. Progress events can
// arrive before ez-ai has recorded its own earlier step (the fulfiller starts
// right after accepting the job), so a step that starts or ends also closes
// every earlier step that was still open, and an event never moves the
// current step back.
func (a *ProductFulfillmentAttempt) applyEvent(event ProductFulfillmentEvent) {
	index := slices.IndexFunc(a.Steps, func(step ProductFulfillmentStepState) bool { return step.Key == event.Step })
	if index < 0 && event.Status == ProductFulfillmentStepFailed {
		// A failure that names no known step (an older fulfiller, or a crash)
		// belongs to the step that was running, or else the next one.
		index = a.openStepIndex()
		if index >= 0 {
			event.Step = a.Steps[index].Key
		}
	}
	if len(a.Events) < productFulfillmentMaxEvents {
		a.Events = append(a.Events, event)
	}
	if index < 0 {
		return
	}
	for i := range index {
		earlier := &a.Steps[i]
		if earlier.Status != ProductFulfillmentStepPending && earlier.Status != ProductFulfillmentStepRunning {
			continue
		}
		if earlier.Status == ProductFulfillmentStepRunning {
			earlier.FinishedAt = event.At
		}
		earlier.Status = ProductFulfillmentStepSucceeded
	}
	step := &a.Steps[index]
	if step.StartedAt == 0 {
		step.StartedAt = event.At
	}
	if event.Status == ProductFulfillmentEventInfo {
		if step.Status == ProductFulfillmentStepPending {
			step.Status = ProductFulfillmentStepRunning
		}
	} else {
		step.Status = event.Status
		if event.Status != ProductFulfillmentStepRunning {
			step.FinishedAt = event.At
		}
		if event.Message != "" {
			step.Message = event.Message
			step.Params = event.Params
		}
	}
	for i := len(a.Steps) - 1; i >= 0; i-- {
		if a.Steps[i].Status != ProductFulfillmentStepPending {
			a.CurrentStep = a.Steps[i].Key
			break
		}
	}
}

// openStepIndex is the step still running at the front of the attempt, or
// the one after the last finished step; -1 when every step is finished.
func (a *ProductFulfillmentAttempt) openStepIndex() int {
	last := -1
	for i, step := range a.Steps {
		if step.Status == ProductFulfillmentStepRunning {
			return i
		}
		if step.Status != ProductFulfillmentStepPending {
			last = i
		}
	}
	if last+1 < len(a.Steps) {
		return last + 1
	}
	return -1
}

// CreateProductFulfillmentAttempt records a new attempt for the order with
// its first step, checking the order and settings, already running.
func CreateProductFulfillmentAttempt(order *ProductOrder, plan string, operatorId int, operatorName string) (*ProductFulfillmentAttempt, error) {
	now := common.GetTimestamp()
	attempt := &ProductFulfillmentAttempt{
		OrderId:      order.Id,
		TradeNo:      order.TradeNo,
		Plan:         plan,
		Status:       ProductFulfillmentRunning,
		OperatorId:   operatorId,
		OperatorName: truncateProductRunes(operatorName, 64),
		StartedAt:    now,
		UpdatedAt:    now,
		Events:       []ProductFulfillmentEvent{},
	}
	for _, key := range ProductFulfillmentSteps {
		attempt.Steps = append(attempt.Steps, ProductFulfillmentStepState{Key: key, Status: ProductFulfillmentStepPending})
	}
	attempt.applyEvent(NewProductFulfillmentEvent(ProductFulfillmentStepPrepare, ProductFulfillmentStepRunning,
		"Checking the order and the fulfillment settings", nil))
	if err := attempt.encodeJSONColumns(); err != nil {
		return nil, err
	}
	if err := DB.Create(attempt).Error; err != nil {
		return nil, err
	}
	return attempt, nil
}

// RecordProductFulfillmentEvent adds an event to a running attempt of the
// order tradeNo. finalStatus, when ProductFulfillmentSucceeded or
// ProductFulfillmentFailed, also ends the attempt. Events for an attempt
// that has ended are rejected with ErrProductOrderStatusConflict, so a
// replayed callback cannot reopen it.
func RecordProductFulfillmentEvent(attemptId int, tradeNo string, event ProductFulfillmentEvent, finalStatus string) error {
	productFulfillmentAttemptMutex.Lock()
	defer productFulfillmentAttemptMutex.Unlock()
	return DB.Transaction(func(tx *gorm.DB) error {
		var attempt ProductFulfillmentAttempt
		err := lockForUpdate(tx).Where("id = ? AND trade_no = ?", attemptId, tradeNo).First(&attempt).Error
		if err != nil {
			return err
		}
		if attempt.Status != ProductFulfillmentRunning {
			return ErrProductOrderStatusConflict
		}
		if err := attempt.decodeJSONColumns(); err != nil {
			return fmt.Errorf("decode product fulfillment attempt %d: %w", attempt.Id, err)
		}
		attempt.applyEvent(event)
		updates := map[string]any{
			"current_step": attempt.CurrentStep,
			"updated_at":   event.At,
		}
		if finalStatus != "" {
			updates["status"] = finalStatus
			updates["finished_at"] = event.At
			// The attempt is over, so its card can pay for the next order.
			if err := releasePaymentCardLeases(tx, attempt.Id); err != nil {
				return err
			}
		}
		if err := attempt.encodeJSONColumns(); err != nil {
			return err
		}
		updates["steps"] = attempt.StepsJSON
		updates["events"] = attempt.EventsJSON
		return tx.Model(&ProductFulfillmentAttempt{}).Where("id = ?", attempt.Id).Updates(updates).Error
	})
}

// FindRunningProductFulfillmentAttemptId returns the newest running attempt
// of the order, for results from a fulfiller that does not send attempt ids;
// 0 when there is none.
func FindRunningProductFulfillmentAttemptId(tradeNo string) (int, error) {
	var attempts []ProductFulfillmentAttempt
	err := DB.Select("id").Where("trade_no = ? AND status = ?", tradeNo, ProductFulfillmentRunning).
		Order("id desc").Limit(1).Find(&attempts).Error
	if err != nil || len(attempts) == 0 {
		return 0, err
	}
	return attempts[0].Id, nil
}

// ListProductFulfillmentAttempts returns every attempt of the order, newest
// first, numbered from the oldest.
func ListProductFulfillmentAttempts(orderId int) ([]ProductFulfillmentAttempt, error) {
	var attempts []ProductFulfillmentAttempt
	if err := DB.Where("order_id = ?", orderId).Order("id desc").Find(&attempts).Error; err != nil {
		return nil, err
	}
	for i := range attempts {
		if err := attempts[i].decodeJSONColumns(); err != nil {
			return nil, fmt.Errorf("decode product fulfillment attempt %d: %w", attempts[i].Id, err)
		}
		attempts[i].Seq = len(attempts) - i
	}
	return attempts, nil
}
