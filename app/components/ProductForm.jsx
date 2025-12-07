import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { getProductOptions } from '@shopify/hydrogen';
import { AddToCartButton } from './AddToCartButton';
import { useAside } from './Aside';

/**
 * @param {{
 *   productOptions: MappedProductOptions[];
 *   selectedVariant: ProductFragment['selectedOrFirstAvailableVariant'];
 *   selectedColorProduct?: ProductFragment | null;
 * }}
 */
export function ProductForm({ productOptions, selectedVariant, selectedColorProduct }) {
  const navigate = useNavigate();
  const { open } = useAside();
  const [sizeQuantities, setSizeQuantities] = useState({});

  const sizeOption = productOptions.find(
    (option) => option.name.toLowerCase() === 'size',
  );

  // Get product options from selected color product if available
  // getProductOptions will extract adjacentVariants from the product automatically
  const colorProductOptions = selectedColorProduct
    ? getProductOptions({
      ...selectedColorProduct,
      selectedOrFirstAvailableVariant: selectedColorProduct.selectedOrFirstAvailableVariant,
    })
    : null;

  // Use size option from selected color product if available, otherwise use original
  const effectiveSizeOption = colorProductOptions
    ? colorProductOptions.find((option) => option.name.toLowerCase() === 'size')
    : sizeOption;

  // If we have a Size option with multiple values, use the new size selector
  if (sizeOption && sizeOption.optionValues.length > 1) {
    const handleQuantityChange = (sizeName, quantity) => {
      setSizeQuantities((prev) => ({
        ...prev,
        [sizeName]: quantity,
      }));
    };

    // Helper function to find variant by size in the selected color product
    const findVariantForSize = (sizeName) => {
      if (!selectedColorProduct || !selectedColorProduct.adjacentVariants) {
        return null;
      }

      // Find variant in selected color product that matches this size
      // Match by comparing the size option value (case-insensitive for option name, exact for value)
      const matchingVariant = selectedColorProduct.adjacentVariants.find((variant) => {
        if (!variant?.selectedOptions) return false;
        const sizeOption = variant.selectedOptions.find(
          (opt) => opt?.name?.toLowerCase() === 'size',
        );
        // Compare size values (trim and case-sensitive for exact match)
        return sizeOption?.value?.trim() === sizeName?.trim();
      });

      return matchingVariant || null;
    };

    // Build cart lines using variants from the selected color product
    const cartLines = sizeOption.optionValues
      .filter((value) => {
        const quantity = sizeQuantities[value.name];
        if (!quantity || quantity <= 0) return false;

        // Find variant for this size
        let variant = findVariantForSize(value.name);
        if (!variant) {
          const colorSizeValue = effectiveSizeOption?.optionValues.find(
            (v) => v.name === value.name,
          );
          variant = colorSizeValue?.firstSelectableVariant;
        }
        if (!variant) {
          variant = value.firstSelectableVariant;
        }

        // Check if variant exists and is available
        return variant?.id && variant?.availableForSale;
      })
      .map((value) => {
        // Find variant for this size using the same logic
        let variant = findVariantForSize(value.name);
        if (!variant) {
          const colorSizeValue = effectiveSizeOption?.optionValues.find(
            (v) => v.name === value.name,
          );
          variant = colorSizeValue?.firstSelectableVariant;
        }
        if (!variant) {
          variant = value.firstSelectableVariant;
        }

        return {
          merchandiseId: variant?.id,
          quantity: sizeQuantities[value.name],
          selectedVariant: variant,
        };
      })
      .filter((line) => line.merchandiseId);

    return (
      <div className="product-form">
        {productOptions
          .filter((option) => option.name.toLowerCase() !== 'size')
          .map((option) => (
            <ProductOptionGroup
              key={option.name}
              option={option}
              navigate={navigate}
            />
          ))}

        <SizeSelectorWithQuantities
          sizeOption={sizeOption}
          effectiveSizeOption={effectiveSizeOption}
          sizeQuantities={sizeQuantities}
          onQuantityChange={handleQuantityChange}
          selectedColorProduct={selectedColorProduct}
          cartLines={cartLines}
          onAddToCart={() => open('cart')}
        />
      </div>
    );
  }

  // Standard form for non-size options or single size
  return (
    <div className="product-form">
      {productOptions.map((option) => (
        <ProductOptionGroup
          key={option.name}
          option={option}
          navigate={navigate}
        />
      ))}
      <AddToCartButton
        disabled={!selectedVariant || !selectedVariant.availableForSale}
        onClick={() => open('cart')}
        lines={
          selectedVariant
            ? [
              {
                merchandiseId: selectedVariant.id,
                quantity: 1,
                selectedVariant,
              },
            ]
            : []
        }
      >
        {selectedVariant?.availableForSale ? 'Add to cart' : 'Sold out'}
      </AddToCartButton>
    </div>
  );
}

/**
 * Renders a product option group (Color, etc.)
 */
function ProductOptionGroup({ option, navigate }) {
  if (option.optionValues.length === 1) return null;

  return (
    <div className="product-options">
      <h5>{option.name}</h5>
      <div className="product-options-grid">
        {option.optionValues.map((value) => (
          <ProductOptionItem
            key={option.name + value.name}
            optionName={option.name}
            value={value}
            navigate={navigate}
          />
        ))}
      </div>
      <br />
    </div>
  );
}

/**
 * Renders a single product option item
 */
function ProductOptionItem({ optionName, value, navigate }) {
  const {
    name,
    handle,
    variantUriQuery,
    selected,
    available,
    exists,
    isDifferentProduct,
    swatch,
  } = value;

  const commonProps = {
    className: 'product-options-item',
    style: {
      border: selected ? '1px solid black' : '1px solid transparent',
      opacity: available ? 1 : 0.3,
    },
  };

  if (isDifferentProduct) {
    return (
      <Link
        {...commonProps}
        key={optionName + name}
        prefetch="intent"
        preventScrollReset
        replace
        to={`/products/${handle}?${variantUriQuery}`}
      >
        <ProductOptionSwatch swatch={swatch} name={name} />
      </Link>
    );
  }

  return (
    <button
      {...commonProps}
      type="button"
      className={`product-options-item${exists && !selected ? ' link' : ''}`}
      disabled={!exists}
      onClick={() => {
        if (!selected) {
          void navigate(`?${variantUriQuery}`, {
            replace: true,
            preventScrollReset: true,
          });
        }
      }}
    >
      <ProductOptionSwatch swatch={swatch} name={name} />
    </button>
  );
}

/**
 * Size selector with quantity inputs
 * @param {{
 *   sizeOption: MappedProductOptions;
 *   effectiveSizeOption?: MappedProductOptions | null;
 *   sizeQuantities: Record<string, number>;
 *   onQuantityChange: (sizeName: string, quantity: number) => void;
 *   selectedColorProduct?: ProductFragment | null;
 *   cartLines?: Array<any>;
 *   onAddToCart?: () => void;
 * }}
 */
function SizeSelectorWithQuantities({
  sizeOption,
  effectiveSizeOption,
  sizeQuantities,
  onQuantityChange,
  selectedColorProduct,
  cartLines = [],
  onAddToCart,
}) {
  // Helper function to find variant by size in the selected color product
  const findVariantForSize = (sizeName) => {
    if (!selectedColorProduct || !selectedColorProduct.adjacentVariants) {
      return null;
    }

    // Normalize the size name for comparison
    const normalizedSizeName = sizeName?.trim();

    // Find variant in selected color product that matches this size
    // Match by comparing the size option value (case-insensitive for option name, exact for value)
    const matchingVariant = selectedColorProduct.adjacentVariants.find((variant) => {
      if (!variant?.selectedOptions) return false;

      // Verify this variant belongs to the selected color product
      if (variant.product?.handle !== selectedColorProduct.handle) {
        return false;
      }

      const sizeOption = variant.selectedOptions.find(
        (opt) => opt?.name?.toLowerCase() === 'size',
      );

      if (!sizeOption) return false;

      // Compare size values (trim and exact match)
      const variantSizeValue = sizeOption.value?.trim();
      return variantSizeValue === normalizedSizeName;
    });

    // Debug logging for 4XL specifically
    if (normalizedSizeName === '4XL' || normalizedSizeName === '4XL') {
      console.log(`[SizeSelector] Looking for size: ${normalizedSizeName}`);
      console.log(`[SizeSelector] Selected color product:`, selectedColorProduct.title);
      console.log(`[SizeSelector] Adjacent variants count:`, selectedColorProduct.adjacentVariants?.length);
      console.log(`[SizeSelector] Found variant:`, matchingVariant);
      if (matchingVariant) {
        console.log(`[SizeSelector] Variant availableForSale:`, matchingVariant.availableForSale);
        console.log(`[SizeSelector] Variant selectedOptions:`, matchingVariant.selectedOptions);
      }
    }

    return matchingVariant || null;
  };

  // Log all adjacent variants for debugging
  if (selectedColorProduct?.adjacentVariants) {
    console.log(`[SizeSelector] Selected Color Product: ${selectedColorProduct.title} (${selectedColorProduct.handle})`);
    console.log(`[SizeSelector] Total adjacent variants: ${selectedColorProduct.adjacentVariants.length}`);
    console.log(`[SizeSelector] All adjacent variants:`, selectedColorProduct.adjacentVariants.map(v => ({
      id: v.id,
      title: v.title,
      size: v.selectedOptions?.find(opt => opt.name?.toLowerCase() === 'size')?.value,
      color: v.selectedOptions?.find(opt => opt.name?.toLowerCase() === 'color')?.value,
      availableForSale: v.availableForSale,
      productHandle: v.product?.handle,
      allOptions: v.selectedOptions
    })));
  }

  return (
    <div className="size-selector-with-quantities">
      <h5 className="size-selector-title">Choose Size</h5>
      <div className="size-selector-grid">
        {sizeOption.optionValues.map((value) => {
          // First try to find variant from selected color product by matching size
          let variant = findVariantForSize(value.name);

          // If we have a selected color product, ONLY use variants from that product
          // Don't fall back to original product variants
          if (!variant && selectedColorProduct && effectiveSizeOption) {
            // Try using the effective size option's firstSelectableVariant
            // but verify it belongs to the selected color product and matches the size
            const colorSizeValue = effectiveSizeOption.optionValues.find(
              (v) => v.name === value.name,
            );
            const candidateVariant = colorSizeValue?.firstSelectableVariant;

            // Verify the variant belongs to the selected color product and matches the size
            if (candidateVariant) {
              const variantSizeOption = candidateVariant.selectedOptions?.find(
                (opt) => opt?.name?.toLowerCase() === 'size',
              );
              const variantSizeValue = variantSizeOption?.value?.trim();

              if (candidateVariant.product?.handle === selectedColorProduct.handle &&
                variantSizeValue === value.name.trim()) {
                variant = candidateVariant;
              }
            }
          }

          // Only fallback to original product's variant if we don't have a selected color product
          if (!variant && !selectedColorProduct) {
            variant = value.firstSelectableVariant;
          }

          const quantity = sizeQuantities[value.name] || 0;
          const price = variant?.price?.amount
            ? parseFloat(variant.price.amount)
            : 0;

          // Determine availability: use variant's availableForSale if we have a variant from selected color product
          // If we have a selected color product but no variant found, mark as unavailable
          // Only use original value's availability if no color product is selected
          let available = false;
          if (variant) {
            // Verify variant belongs to selected color product if one is selected
            if (selectedColorProduct) {
              if (variant.product?.handle === selectedColorProduct.handle) {
                available = variant.availableForSale === true;
              } else {
                // Variant doesn't belong to selected color product - mark as unavailable
                available = false;
              }
            } else {
              // No color product selected, use variant's availability
              available = variant.availableForSale === true;
            }
          } else if (!selectedColorProduct) {
            // Only fallback to original value's availability if no color product selected
            available = value.available && value.exists;
          }
          // If selectedColorProduct exists but no variant found, available remains false

          // Get actual inventory quantity if available, otherwise use availableForSale boolean
          // NOTE: quantityAvailable requires the 'unauthenticated_read_product_inventory' scope
          // to be enabled in your Shopify app settings. If it's null, you need to:
          // 1. Go to your Shopify Admin → Apps → Your Storefront API app
          // 2. Enable the 'unauthenticated_read_product_inventory' scope
          // 3. Save and re-authenticate if needed
          let stockQuantity = 0;
          if (variant && variant.quantityAvailable !== null && variant.quantityAvailable !== undefined) {
            // Use actual quantity from API
            stockQuantity = variant.quantityAvailable;
          } else if (available) {
            // Fallback: if available but no quantity data, show 999+
            // This happens when quantityAvailable is null (API scope not enabled)
            stockQuantity = 999;
          } else {
            // Not available
            stockQuantity = 0;
          }

          // Console log for each size with all relevant information
          console.log(`[SizeSelector] Size: ${value.name}`, {
            sizeName: value.name,
            selectedColorProduct: selectedColorProduct?.title || 'None',
            variantFound: !!variant,
            variantId: variant?.id,
            variantTitle: variant?.title,
            variantSize: variant?.selectedOptions?.find(opt => opt.name?.toLowerCase() === 'size')?.value,
            variantColor: variant?.selectedOptions?.find(opt => opt.name?.toLowerCase() === 'color')?.value,
            variantProductHandle: variant?.product?.handle,
            variantAvailableForSale: variant?.availableForSale,
            variantQuantityAvailable: variant?.quantityAvailable,
            available: available,
            stockQuantity: stockQuantity,
            price: price,
            allVariantOptions: variant?.selectedOptions
          });

          return (
            <div
              key={value.name}
              className={`size-selector-item ${!available ? 'unavailable' : ''}`}
            >
              <div className="size-label">{value.name}</div>
              <div className="size-input-container">
                <input
                  type="number"
                  min="0"
                  value={quantity || ''}
                  onChange={(e) => {
                    const newQuantity = parseInt(e.target.value, 10) || 0;
                    onQuantityChange(value.name, newQuantity);
                  }}
                  className="size-quantity-input"
                  disabled={!available}
                  placeholder="0"
                />
              </div>
              <div className="size-price">${price.toFixed(2)}</div>
              <div className="size-stock">
                {stockQuantity > 0 ? (
                  <>
                    <span className="stock-quantity">
                      {stockQuantity >= 999 ? '999+' : stockQuantity}
                    </span>
                    <span className="stock-label"> In Stock</span>
                  </>
                ) : (
                  <span className="stock-label out-of-stock">Out of Stock</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {onAddToCart && (
        <div className="size-selector-add-to-cart-wrapper">
          <AddToCartButton
            disabled={cartLines.length === 0}
            onClick={onAddToCart}
            lines={cartLines}
          >
            ADD TO CART
          </AddToCartButton>
        </div>
      )}
    </div>
  );
}

/**
 * @param {{
 *   swatch?: Maybe<ProductOptionValueSwatch> | undefined;
 *   name: string;
 * }}
 */
function ProductOptionSwatch({ swatch, name }) {
  const image = swatch?.image?.previewImage?.url;
  const color = swatch?.color;

  if (!image && !color) return name;

  return (
    <div
      aria-label={name}
      className="product-option-label-swatch"
      style={{
        backgroundColor: color || 'transparent',
      }}
    >
      {!!image && <img src={image} alt={name} />}
    </div>
  );
}

/** @typedef {import('@shopify/hydrogen').MappedProductOptions} MappedProductOptions */
/** @typedef {import('@shopify/hydrogen/storefront-api-types').Maybe} Maybe */
/** @typedef {import('@shopify/hydrogen/storefront-api-types').ProductOptionValueSwatch} ProductOptionValueSwatch */
/** @typedef {import('storefrontapi.generated').ProductFragment} ProductFragment */
