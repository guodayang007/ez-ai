package model

import (
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// productDefaultsSeededKey marks that the default catalog was offered once,
// so deleting every product does not bring the defaults back on restart.
const productDefaultsSeededKey = "ProductDefaultsSeeded"

var errProductDefaultsSeededReadOnly = errors.New("ProductDefaultsSeeded is managed by the server")

// defaultProductTier is one 1-month option of the default catalog.
type defaultProductTier struct {
	name string
	// Prices are in cents to keep the derived amounts exact.
	monthlyCents int64
	// savingCents is the struck-through saving shown next to the price.
	savingCents int64
}

var defaultChatGPTTiers = []defaultProductTier{
	{name: "Go", monthlyCents: 1699, savingCents: 299},
	{name: "Plus", monthlyCents: 4299, savingCents: 299},
	{name: "Pro 100", monthlyCents: 20399, savingCents: 599},
	{name: "Pro 200", monthlyCents: 40599, savingCents: 599},
	{name: "Pro 500", monthlyCents: 102099, savingCents: 1899},
}

func buildDefaultChatGPTProduct() *Product {
	product := &Product{
		Title:       "ChatGPT",
		Subtitle:    "Go / Plus / Pro 官方订阅",
		Icon:        "OpenAI",
		Description: "选择档位后，按提示在 ChatGPT 获取 Session 并粘贴，验证通过即可下单，我们会为该账号开通订阅。",
		Enabled:     true,
		InputFields: []ProductInputField{{
			Key:         "chatgpt_session",
			Label:       "ChatGPT Session",
			Type:        ProductInputChatGPTSession,
			Required:    true,
			Placeholder: `{"user":{...},"expires":"...","accessToken":"..."}`,
			Description: "登录 chatgpt.com 后打开 chatgpt.com/api/auth/session，复制页面全部内容",
		}},
	}
	sortOrder := len(defaultChatGPTTiers)
	for _, tier := range defaultChatGPTTiers {
		product.Skus = append(product.Skus, ProductSku{
			Name:          tier.name + " · 1 个月",
			PriceAmount:   float64(tier.monthlyCents) / 100,
			OriginalPrice: float64(tier.monthlyCents+tier.savingCents) / 100,
			Currency:      "USD",
			Tag:           "自动开通",
			Enabled:       true,
			SortOrder:     sortOrder,
		})
		sortOrder--
	}
	return product
}

// SeedDefaultProducts adds the default ChatGPT catalog the first time the
// server starts with an empty product table. It runs once per database.
func SeedDefaultProducts() error {
	var marker Option
	err := DB.Where(&Option{Key: productDefaultsSeededKey}).First(&marker).Error
	if err == nil {
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	var count int64
	if err := DB.Model(&Product{}).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		if err := SaveProduct(buildDefaultChatGPTProduct()); err != nil {
			return err
		}
	}
	return DB.Clauses(clause.OnConflict{DoNothing: true}).
		Create(&Option{Key: productDefaultsSeededKey, Value: "true"}).Error
}
