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

    // Build cart lines using variants from the selected color product
    const cartLines = sizeOption.optionValues
      .filter((value) => {
        const quantity = sizeQuantities[value.name];
        return quantity && quantity > 0 && value.exists && value.available;
      })
      .map((value) => {
        // Find the matching size option value in the color product
        const colorSizeValue = effectiveSizeOption?.optionValues.find(
          (v) => v.name === value.name,
        );
        // Use variant from color product if available, otherwise fallback to original
        const variant = colorSizeValue?.firstSelectableVariant || value.firstSelectableVariant;
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
        />

        <AddToCartButton
          disabled={cartLines.length === 0}
          onClick={() => open('cart')}
          lines={cartLines}
        >
          ADD TO CART
        </AddToCartButton>
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
 * }}
 */
function SizeSelectorWithQuantities({
  sizeOption,
  effectiveSizeOption,
  sizeQuantities,
  onQuantityChange,
}) {
  return (
    <div className="size-selector-with-quantities">
      <h5 className="size-selector-title">Choose Size</h5>
      <div className="size-selector-grid">
        {sizeOption.optionValues.map((value) => {
          // Find matching size in the effective (color) product
          const colorSizeValue = effectiveSizeOption?.optionValues.find(
            (v) => v.name === value.name,
          );
          // Use variant from color product if available, otherwise use original
          const variant = colorSizeValue?.firstSelectableVariant || value.firstSelectableVariant;
          const quantity = sizeQuantities[value.name] || 0;
          const price = variant?.price?.amount
            ? parseFloat(variant.price.amount)
            : 0;
          // Use availability from color product variant if available
          const available = colorSizeValue
            ? colorSizeValue.available && colorSizeValue.exists && variant?.availableForSale
            : value.available && value.exists && variant?.availableForSale;
          // Show 999+ for available items, 0 for unavailable
          const stockQuantity = available ? 999 : 0;

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
