package system_setting

// ProductFulfillerConfig holds the product fulfiller settings (connection,
// plans, payment card, billing address) encrypted with CONFIG_ENCRYPTION_KEY.
// Read and write it through service.LoadProductFulfillerConfig and
// service.SaveProductFulfillerConfig, never as plain text.
var ProductFulfillerConfig = ""

// ProductFulfillerConfigOption is the options table key of
// ProductFulfillerConfig.
const ProductFulfillerConfigOption = "ProductFulfillerConfig"
