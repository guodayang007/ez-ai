package model

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// Input field types a SKU can ask the buyer to fill in when ordering.
const (
	ProductInputText     = "text"
	ProductInputTextarea = "textarea"
	ProductInputSecret   = "secret"
	ProductInputJSON     = "json"
	ProductInputBase64   = "base64"
	// ProductInputChatGPTSession is the JSON the buyer copies from
	// chatgpt.com/api/auth/session; it carries the account access token.
	ProductInputChatGPTSession = "chatgpt_session"
)

// Product order lifecycle. Payment is not integrated yet, so a new order
// starts as pending and an admin moves it forward by hand.
const (
	ProductOrderPending    = "pending"
	ProductOrderPaid       = "paid"
	ProductOrderProcessing = "processing"
	ProductOrderCompleted  = "completed"
	ProductOrderCancelled  = "cancelled"
	ProductOrderRefunded   = "refunded"
)

// productOrderTransitions lists the statuses an admin may move an order to.
var productOrderTransitions = map[string][]string{
	ProductOrderPending:    {ProductOrderPaid, ProductOrderProcessing, ProductOrderCompleted, ProductOrderCancelled},
	ProductOrderPaid:       {ProductOrderProcessing, ProductOrderCompleted, ProductOrderRefunded},
	ProductOrderProcessing: {ProductOrderCompleted, ProductOrderRefunded},
}

var ErrProductOrderStatusConflict = errors.New("product order status changed")

type Product struct {
	Id          int    `json:"id"`
	Title       string `json:"title" gorm:"type:varchar(128);not null"`
	Subtitle    string `json:"subtitle" gorm:"type:varchar(255)"`
	Icon        string `json:"icon" gorm:"type:varchar(1024)"`
	Description string `json:"description" gorm:"type:text"`
	Enabled     bool   `json:"enabled"`
	SortOrder   int    `json:"sort_order" gorm:"index"`
	// InputFieldsJSON stores []ProductInputField shared by every SKU of the
	// product; read it through InputFields.
	InputFieldsJSON string `json:"-" gorm:"column:input_fields;type:text"`
	CreatedAt       int64  `json:"created_at"`
	UpdatedAt       int64  `json:"updated_at"`

	InputFields []ProductInputField `json:"input_fields" gorm:"-"`
	Skus        []ProductSku        `json:"skus" gorm:"-"`
}

// ProductInputField describes one value the buyer submits with an order,
// such as a session key or a base64 encoded credential file.
type ProductInputField struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Type        string `json:"type"`
	Required    bool   `json:"required"`
	Placeholder string `json:"placeholder"`
	Description string `json:"description"`
	MaxLength   int    `json:"max_length"`
}

type ProductSku struct {
	Id          int     `json:"id"`
	ProductId   int     `json:"product_id" gorm:"index"`
	Name        string  `json:"name" gorm:"type:varchar(128);not null"`
	PriceAmount float64 `json:"price_amount"`
	// OriginalPrice is the struck-through reference price; 0 means none.
	// The storefront shows the difference as the buyer's saving.
	OriginalPrice float64 `json:"original_price"`
	Currency      string  `json:"currency" gorm:"type:varchar(8)"`
	// Tag is a short badge shown next to the price, such as a delivery note.
	Tag       string `json:"tag" gorm:"type:varchar(64)"`
	Enabled   bool   `json:"enabled"`
	SortOrder int    `json:"sort_order"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
}

type ProductOrder struct {
	Id      int    `json:"id"`
	UserId  int    `json:"user_id" gorm:"index"`
	TradeNo string `json:"trade_no" gorm:"type:varchar(64);uniqueIndex"`

	ProductId    int     `json:"product_id" gorm:"index"`
	SkuId        int     `json:"sku_id"`
	ProductTitle string  `json:"product_title" gorm:"type:varchar(128)"`
	SkuName      string  `json:"sku_name" gorm:"type:varchar(128)"`
	PriceAmount  float64 `json:"price_amount"`
	Currency     string  `json:"currency" gorm:"type:varchar(8)"`

	// Snapshots taken at order time so later SKU edits do not change how an
	// existing order is displayed.
	InputFieldsJSON string `json:"-" gorm:"column:input_fields;type:text"`
	// Buyer values can include large base64 files, so this column is
	// longtext on MySQL where plain text stops at 64 KiB.
	InputsJSON LongText `json:"-" gorm:"column:inputs"`

	Status       string `json:"status" gorm:"type:varchar(16);index"`
	Remark       string `json:"remark" gorm:"type:varchar(512)"`
	DeliveryNote string `json:"delivery_note" gorm:"type:text"`
	CreatedAt    int64  `json:"created_at" gorm:"index"`
	UpdatedAt    int64  `json:"updated_at"`
	CompletedAt  int64  `json:"completed_at"`

	InputFields []ProductInputField `json:"input_fields" gorm:"-"`
	Inputs      map[string]string   `json:"inputs" gorm:"-"`
	Username    string              `json:"username,omitempty" gorm:"-"`
}

func (p *Product) decodeInputFields() error {
	p.InputFields = []ProductInputField{}
	if strings.TrimSpace(p.InputFieldsJSON) == "" {
		return nil
	}
	return common.UnmarshalJsonStr(p.InputFieldsJSON, &p.InputFields)
}

func (p *Product) encodeInputFields() error {
	fields := p.InputFields
	if fields == nil {
		fields = []ProductInputField{}
	}
	data, err := common.Marshal(fields)
	if err != nil {
		return err
	}
	p.InputFieldsJSON = string(data)
	return nil
}

func (o *ProductOrder) decodeJSONColumns() error {
	o.InputFields = []ProductInputField{}
	o.Inputs = map[string]string{}
	if strings.TrimSpace(o.InputFieldsJSON) != "" {
		if err := common.UnmarshalJsonStr(o.InputFieldsJSON, &o.InputFields); err != nil {
			return err
		}
	}
	if strings.TrimSpace(string(o.InputsJSON)) != "" {
		if err := common.UnmarshalJsonStr(string(o.InputsJSON), &o.Inputs); err != nil {
			return err
		}
	}
	return nil
}

// MaskSecretInputs hides secret values, including ChatGPT sessions, before an
// order is shown to its buyer.
func (o *ProductOrder) MaskSecretInputs() {
	for _, field := range o.InputFields {
		if field.Type != ProductInputSecret && field.Type != ProductInputChatGPTSession {
			continue
		}
		value := o.Inputs[field.Key]
		if value == "" {
			continue
		}
		if len(value) <= 8 {
			o.Inputs[field.Key] = strings.Repeat("*", len(value))
			continue
		}
		o.Inputs[field.Key] = value[:4] + strings.Repeat("*", 8) + value[len(value)-4:]
	}
}

func CanTransitionProductOrder(from, to string) bool {
	for _, next := range productOrderTransitions[from] {
		if next == to {
			return true
		}
	}
	return false
}

func loadProductSkus(products []Product, enabledOnly bool) error {
	if len(products) == 0 {
		return nil
	}
	ids := make([]int, 0, len(products))
	for _, p := range products {
		ids = append(ids, p.Id)
	}
	query := DB.Where("product_id IN ?", ids)
	if enabledOnly {
		query = query.Where("enabled = ?", true)
	}
	var skus []ProductSku
	if err := query.Order("sort_order desc, id asc").Find(&skus).Error; err != nil {
		return err
	}
	byProduct := map[int][]ProductSku{}
	for i := range skus {
		byProduct[skus[i].ProductId] = append(byProduct[skus[i].ProductId], skus[i])
	}
	for i := range products {
		if err := products[i].decodeInputFields(); err != nil {
			return fmt.Errorf("decode input fields of product %d: %w", products[i].Id, err)
		}
		products[i].Skus = byProduct[products[i].Id]
		if products[i].Skus == nil {
			products[i].Skus = []ProductSku{}
		}
	}
	return nil
}

// ListProducts returns products with their SKUs. The storefront passes
// enabledOnly so that disabled products, disabled SKUs and products without a
// sellable SKU are hidden.
func ListProducts(enabledOnly bool) ([]Product, error) {
	query := DB.Order("sort_order desc, id desc")
	if enabledOnly {
		query = query.Where("enabled = ?", true)
	}
	var products []Product
	if err := query.Find(&products).Error; err != nil {
		return nil, err
	}
	if err := loadProductSkus(products, enabledOnly); err != nil {
		return nil, err
	}
	if !enabledOnly {
		return products, nil
	}
	sellable := make([]Product, 0, len(products))
	for _, p := range products {
		if len(p.Skus) > 0 {
			sellable = append(sellable, p)
		}
	}
	return sellable, nil
}

func GetProductById(id int) (*Product, error) {
	var product Product
	if err := DB.First(&product, id).Error; err != nil {
		return nil, err
	}
	products := []Product{product}
	if err := loadProductSkus(products, false); err != nil {
		return nil, err
	}
	return &products[0], nil
}

// SaveProduct creates or updates a product together with its SKU list. SKUs
// missing from the list are deleted; existing orders keep their snapshots.
func SaveProduct(product *Product) error {
	now := common.GetTimestamp()
	return DB.Transaction(func(tx *gorm.DB) error {
		product.UpdatedAt = now
		if err := product.encodeInputFields(); err != nil {
			return err
		}
		if product.Id == 0 {
			product.CreatedAt = now
			if err := tx.Create(product).Error; err != nil {
				return err
			}
		} else {
			result := tx.Model(&Product{}).Where("id = ?", product.Id).Updates(map[string]any{
				"title":        product.Title,
				"subtitle":     product.Subtitle,
				"icon":         product.Icon,
				"description":  product.Description,
				"enabled":      product.Enabled,
				"sort_order":   product.SortOrder,
				"input_fields": product.InputFieldsJSON,
				"updated_at":   now,
			})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				return gorm.ErrRecordNotFound
			}
		}

		var existing []ProductSku
		if err := tx.Where("product_id = ?", product.Id).Find(&existing).Error; err != nil {
			return err
		}
		existingIds := map[int]bool{}
		for _, sku := range existing {
			existingIds[sku.Id] = true
		}
		keptIds := map[int]bool{}
		for i := range product.Skus {
			sku := &product.Skus[i]
			sku.ProductId = product.Id
			sku.UpdatedAt = now
			if sku.Id != 0 && existingIds[sku.Id] {
				keptIds[sku.Id] = true
				if err := tx.Model(&ProductSku{}).Where("id = ?", sku.Id).Updates(map[string]any{
					"name":           sku.Name,
					"price_amount":   sku.PriceAmount,
					"original_price": sku.OriginalPrice,
					"currency":       sku.Currency,
					"tag":            sku.Tag,
					"enabled":        sku.Enabled,
					"sort_order":     sku.SortOrder,
					"updated_at":     now,
				}).Error; err != nil {
					return err
				}
				continue
			}
			sku.Id = 0
			sku.CreatedAt = now
			if err := tx.Create(sku).Error; err != nil {
				return err
			}
		}
		for id := range existingIds {
			if keptIds[id] {
				continue
			}
			if err := tx.Delete(&ProductSku{}, id).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func SetProductEnabled(id int, enabled bool) error {
	result := DB.Model(&Product{}).Where("id = ?", id).Updates(map[string]any{
		"enabled":    enabled,
		"updated_at": common.GetTimestamp(),
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func DeleteProduct(id int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("product_id = ?", id).Delete(&ProductSku{}).Error; err != nil {
			return err
		}
		result := tx.Delete(&Product{}, id)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
}

// GetSellableSku returns an enabled SKU of an enabled product.
func GetSellableSku(skuId int) (*Product, *ProductSku, error) {
	var sku ProductSku
	if err := DB.Where("id = ? AND enabled = ?", skuId, true).First(&sku).Error; err != nil {
		return nil, nil, err
	}
	var product Product
	if err := DB.Where("id = ? AND enabled = ?", sku.ProductId, true).First(&product).Error; err != nil {
		return nil, nil, err
	}
	if err := product.decodeInputFields(); err != nil {
		return nil, nil, err
	}
	return &product, &sku, nil
}

func CountUserProductOrders(userId int, status string) (int64, error) {
	var count int64
	err := DB.Model(&ProductOrder{}).Where("user_id = ? AND status = ?", userId, status).Count(&count).Error
	return count, err
}

func CreateProductOrder(order *ProductOrder) error {
	fields, err := common.Marshal(order.InputFields)
	if err != nil {
		return err
	}
	inputs, err := common.Marshal(order.Inputs)
	if err != nil {
		return err
	}
	now := common.GetTimestamp()
	order.InputFieldsJSON = string(fields)
	order.InputsJSON = LongText(inputs)
	order.Status = ProductOrderPending
	order.CreatedAt = now
	order.UpdatedAt = now
	if order.TradeNo == "" {
		order.TradeNo = fmt.Sprintf("PO%d%s", now, common.GetRandomString(8))
	}
	return DB.Create(order).Error
}

type ProductOrderQuery struct {
	UserId  int
	Status  string
	Keyword string
}

func ListProductOrders(query ProductOrderQuery, pageInfo *common.PageInfo) ([]ProductOrder, int64, error) {
	tx := DB.Model(&ProductOrder{})
	if query.UserId > 0 {
		tx = tx.Where("user_id = ?", query.UserId)
	}
	if query.Status != "" {
		tx = tx.Where("status = ?", query.Status)
	}
	if keyword := strings.TrimSpace(query.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		tx = tx.Where("trade_no LIKE ? OR product_title LIKE ? OR sku_name LIKE ?", like, like, like)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var orders []ProductOrder
	if err := tx.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&orders).Error; err != nil {
		return nil, 0, err
	}
	for i := range orders {
		if err := orders[i].decodeJSONColumns(); err != nil {
			return nil, 0, fmt.Errorf("decode product order %d: %w", orders[i].Id, err)
		}
	}
	return orders, total, nil
}

// FillProductOrderUsernames attaches usernames for the admin order list.
func FillProductOrderUsernames(orders []ProductOrder) error {
	if len(orders) == 0 {
		return nil
	}
	ids := make([]int, 0, len(orders))
	for _, o := range orders {
		ids = append(ids, o.UserId)
	}
	var users []User
	if err := DB.Select("id", "username").Where("id IN ?", ids).Find(&users).Error; err != nil {
		return err
	}
	names := make(map[int]string, len(users))
	for _, u := range users {
		names[u.Id] = u.Username
	}
	for i := range orders {
		orders[i].Username = names[orders[i].UserId]
	}
	return nil
}

func GetProductOrder(id int) (*ProductOrder, error) {
	var order ProductOrder
	if err := DB.First(&order, id).Error; err != nil {
		return nil, err
	}
	if err := order.decodeJSONColumns(); err != nil {
		return nil, err
	}
	return &order, nil
}

// UpdateProductOrderStatus moves an order from one status to another. The
// update only applies while the order is still in fromStatus, so two admins
// acting at once cannot both win.
func UpdateProductOrderStatus(id int, fromStatus, toStatus string, deliveryNote *string) error {
	now := common.GetTimestamp()
	updates := map[string]any{
		"status":     toStatus,
		"updated_at": now,
	}
	if toStatus == ProductOrderCompleted {
		updates["completed_at"] = now
	}
	if deliveryNote != nil {
		updates["delivery_note"] = *deliveryNote
	}
	result := DB.Model(&ProductOrder{}).Where("id = ? AND status = ?", id, fromStatus).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrProductOrderStatusConflict
	}
	return nil
}

func UpdateProductOrderDeliveryNote(id int, deliveryNote string) error {
	return DB.Model(&ProductOrder{}).Where("id = ?", id).Updates(map[string]any{
		"delivery_note": deliveryNote,
		"updated_at":    common.GetTimestamp(),
	}).Error
}
