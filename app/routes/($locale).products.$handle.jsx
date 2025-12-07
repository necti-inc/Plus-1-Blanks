import { useState, useEffect, useRef } from 'react';
import { Suspense } from 'react';
import { useLoaderData, Await } from 'react-router';
import {
  getSelectedProductOptions,
  Analytics,
  useOptimisticVariant,
  getProductOptions,
  getAdjacentAndFirstAvailableVariants,
  useSelectedOptionInUrlParam,
} from '@shopify/hydrogen';
import { ProductPrice } from '~/components/ProductPrice';
import { ProductImage } from '~/components/ProductImage';
import { ProductForm } from '~/components/ProductForm';
import { ProductItem } from '~/components/ProductItem';
import { redirectIfHandleIsLocalized } from '~/lib/redirect';

/**
 * @type {Route.MetaFunction}
 */
export const meta = ({ data }) => {
  return [
    { title: `Hydrogen | ${data?.product.title ?? ''}` },
    {
      rel: 'canonical',
      href: `/products/${data?.product.handle}`,
    },
  ];
};

/**
 * @param {Route.LoaderArgs} args
 */
export async function loader(args) {
  // Start fetching non-critical data without blocking time to first byte
  const deferredData = loadDeferredData(args);

  // Await the critical data required to render initial state of the page
  const criticalData = await loadCriticalData(args);

  return { ...deferredData, ...criticalData };
}

/**
 * Load data necessary for rendering content above the fold. This is the critical data
 * needed to render the page. If it's unavailable, the whole page should 400 or 500 error.
 * @param {Route.LoaderArgs}
 */
async function loadCriticalData({ context, params, request }) {
  const { handle } = params;
  const { storefront } = context;

  if (!handle) {
    throw new Error('Expected product handle to be defined');
  }

  const [{ product }] = await Promise.all([
    storefront.query(PRODUCT_QUERY, {
      variables: { handle, selectedOptions: getSelectedProductOptions(request) },
    }),
    // Add other queries here, so that they are loaded in parallel
  ]);

  if (!product?.id) {
    throw new Response(null, { status: 404 });
  }

  // The API handle might be localized, so redirect to the localized handle
  redirectIfHandleIsLocalized(request, { handle, data: product });

  // Extract ProductID from tags
  const productIdTag = product.tags?.find((tag) => tag.startsWith('ProductID:'));
  const productId = productIdTag ? productIdTag.replace('ProductID:', '') : null;

  return {
    product,
    productId,
  };
}

/**
 * Load data for rendering content below the fold. This data is deferred and will be
 * fetched after the initial page load. If it's unavailable, the page should still 200.
 * Make sure to not throw any errors here, as it will cause the page to 500.
 * @param {Route.LoaderArgs}
 */
function loadDeferredData({ context, params, request }) {
  const { handle } = params;
  const { storefront } = context;

  // Create a promise chain that:
  // 1. First gets the current product to find its ProductID tag
  // 2. Then searches for related products
  const relatedProducts = storefront
    .query(PRODUCT_QUERY, {
      variables: { handle, selectedOptions: getSelectedProductOptions(request) },
    })
    .then(({ product: currentProduct }) => {
      console.log('Current Product:', currentProduct);
      console.log('Current Product Tags:', currentProduct?.tags);

      if (!currentProduct?.id) {
        console.log('No current product ID found');
        return { products: { nodes: [] } };
      }

      // Extract ProductID from tags
      const productIdTag = currentProduct.tags?.find((tag) =>
        tag.startsWith('ProductID:'),
      );
      const productId = productIdTag
        ? productIdTag.replace('ProductID:', '').trim()
        : null;

      console.log('ProductID Tag:', productIdTag);
      console.log('Extracted ProductID:', productId);

      if (!productId) {
        console.log('No ProductID found in tags');
        return { products: { nodes: [] } };
      }

      // Search for all products with the same ProductID tag
      const searchTerm = `tag:ProductID:${productId}`;
      console.log('Search Term:', searchTerm);

      return storefront.query(RELATED_PRODUCTS_QUERY, {
        variables: {
          query: searchTerm,
          first: 100, // Get up to 100 products
        },
      });
    })
    .then((result) => {
      console.log('Related Products Query Result:', result);
      console.log('Related Products:', result?.products?.nodes);
      if (result?.products?.nodes) {
        result.products.nodes.forEach((product) => {
          console.log(`Product: ${product.title}`, {
            id: product.id,
            handle: product.handle,
            tags: product.tags,
            colorCodeTag: product.tags?.find((tag) =>
              tag.startsWith('colorCode:'),
            ),
          });
        });
      }
      // Ensure we return the result even if nodes is empty
      return result || { products: { nodes: [] } };
    })
    .catch((error) => {
      console.error('Error fetching related products:', error);
      // Return empty result instead of null to prevent rendering issues
      return { products: { nodes: [] } };
    });

  return {
    relatedProducts,
  };
}

export default function Product() {
  /** @type {LoaderReturnData} */
  const { product, relatedProducts } = useLoaderData();

  // Get current product's colorCode to initialize selected color
  const currentColorCodeTag = product.tags?.find((tag) =>
    tag.startsWith('colorCode:'),
  );
  const initialColorCode = currentColorCodeTag
    ? currentColorCodeTag.replace('colorCode:', '').trim()
    : null;

  const [selectedColor, setSelectedColor] = useState(initialColorCode);
  const [selectedColorProduct, setSelectedColorProduct] = useState(product);
  // Cache for color code to image mapping for faster lookups
  const colorImageCache = useRef(new Map());

  console.log('Product component - relatedProducts:', relatedProducts);

  // Optimistically selects a variant with given available variant information
  const selectedVariant = useOptimisticVariant(
    product.selectedOrFirstAvailableVariant,
    getAdjacentAndFirstAvailableVariants(product),
  );

  // Sets the search param to the selected variant without navigation
  // only when no search params are set in the url
  useSelectedOptionInUrlParam(selectedVariant.selectedOptions);

  // Get the product options array
  const productOptions = getProductOptions({
    ...product,
    selectedOrFirstAvailableVariant: selectedVariant,
  });

  const { title, descriptionHtml } = product;

  // Collect all product images for carousel
  // Priority: selected color product images > current product images
  const allImages = [];

  // Use selected color product if available, otherwise use current product
  const productToUse = selectedColorProduct || product;

  // Add images from product media first
  if (productToUse.media?.nodes) {
    productToUse.media.nodes.forEach((mediaNode) => {
      if (mediaNode?.image) {
        allImages.push(mediaNode.image);
      }
    });
  }

  // Add variant images if not already included
  if (productToUse.adjacentVariants) {
    productToUse.adjacentVariants.forEach((variant) => {
      if (variant?.image && !allImages.find(img => img.id === variant.image.id)) {
        allImages.push(variant.image);
      }
    });
  }

  // Fallback: if no images found, use the display image
  if (allImages.length === 0) {
    const cachedImage = selectedColor ? colorImageCache.current.get(selectedColor) : null;
    const displayImage = cachedImage || selectedColorProduct?.selectedOrFirstAvailableVariant?.image || selectedVariant?.image;
    if (displayImage) {
      allImages.push(displayImage);
    }
  }

  console.log('All Product Images:', allImages);
  console.log('Selected Color Product:', selectedColorProduct);

  return (
    <>
      <div className="product">
        <ProductImage images={allImages} />
        <div className="product-main">
          <h1>{title}</h1>
          {relatedProducts && (
            <ProductColorSwatches
              relatedProducts={relatedProducts}
              selectedColor={selectedColor}
              onColorSelect={(color, product, image) => {
                console.log('Color selected:', color, 'Product:', product);
                console.log('Product image:', image);
                setSelectedColor(color);
                setSelectedColorProduct(product);
                // Cache the image for this color code
                if (color && image) {
                  colorImageCache.current.set(color, image);
                }
              }}
              onColorsExtracted={(colorImageMap) => {
                // Store all color-to-image mappings for fast lookup
                colorImageMap.forEach((image, colorCode) => {
                  colorImageCache.current.set(colorCode, image);
                });
              }}
              currentProductId={product.id}
              currentProduct={product}
            />
          )}
          <ProductPrice
            price={selectedVariant?.price}
            compareAtPrice={selectedVariant?.compareAtPrice}
          />
          <br />
          <ProductForm
            productOptions={productOptions}
            selectedVariant={selectedVariant}
            selectedColorProduct={selectedColorProduct}
          />
          <br />
          <br />
          <p>
            <strong>Description</strong>
          </p>
          <br />
          <div dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
          <br />
        </div>
      </div>
      <Analytics.ProductView
        data={{
          products: [
            {
              id: product.id,
              title: product.title,
              price: selectedVariant?.price.amount || '0',
              vendor: product.vendor,
              variantId: selectedVariant?.id || '',
              variantTitle: selectedVariant?.title || '',
              quantity: 1,
            },
          ],
        }}
      />
    </>
  );
}

/**
 * @param {{
 *   relatedProducts: Promise<any>;
 *   selectedColor: string | null;
 *   onColorSelect: (color: string | null) => void;
 *   currentProductId: string;
 * }}
 */
function RelatedProductsSection({
  relatedProducts,
  selectedColor,
  onColorSelect,
  currentProductId,
}) {
  console.log('RelatedProductsSection rendered, relatedProducts:', relatedProducts);

  return (
    <Suspense fallback={<div>Loading related products...</div>}>
      <Await resolve={relatedProducts}>
        {(data) => {
          console.log('RelatedProductsSection - Data received:', data);
          console.log('Data structure:', JSON.stringify(data, null, 2));

          if (!data?.products?.nodes) {
            console.log('No products nodes found in data');
            return null;
          }

          const products = data.products.nodes.filter(
            (p) => p.id !== currentProductId,
          );

          console.log('Filtered products (excluding current):', products.length);

          if (products.length === 0) {
            console.log('No related products after filtering');
            return null;
          }

          // Extract unique colors from products
          const colorMap = new Map();
          products.forEach((product) => {
            console.log(`Processing product: ${product.title}`, {
              tags: product.tags,
              variant: product.selectedOrFirstAvailableVariant,
            });

            const colorCodeTag = product.tags?.find((tag) =>
              tag.startsWith('colorCode:'),
            );
            console.log('ColorCode Tag found:', colorCodeTag);

            if (colorCodeTag) {
              const colorCode = colorCodeTag.replace('colorCode:', '').trim();
              // Extract color name from colorName tag, fallback to colorCode
              const colorNameTag = product.tags?.find((tag) =>
                tag.startsWith('colorName:'),
              );
              const colorName = colorNameTag
                ? colorNameTag.replace('colorName:', '').trim()
                : colorCode;
              console.log('Color extracted:', { colorCode, colorName });

              if (!colorMap.has(colorCode)) {
                // Ensure color code starts with # if it's a hex code
                const formattedColorCode = colorCode.startsWith('#')
                  ? colorCode
                  : `#${colorCode}`;
                colorMap.set(colorCode, {
                  code: colorCode,
                  formattedCode: formattedColorCode,
                  name: colorName,
                  product: product, // Store product for image access
                });
              }
            }
          });

          console.log('Color Map:', Array.from(colorMap.values()));

          const colors = Array.from(colorMap.values());

          // Filter products by selected color
          const filteredProducts = selectedColor
            ? products.filter((product) => {
              const colorCodeTag = product.tags?.find((tag) =>
                tag.startsWith('colorCode:'),
              );
              return colorCodeTag?.replace('colorCode:', '') === selectedColor;
            })
            : products;

          return (
            <div className="related-products-section">
              <h2>Available Colors</h2>
              <div className="related-products-grid">
                {filteredProducts.map((product) => (
                  <ProductItem key={product.id} product={product} />
                ))}
              </div>
            </div>
          );
        }}
      </Await>
    </Suspense>
  );
}


/**
 * Component to display color swatches in the main product area
 * @param {{
 *   relatedProducts: Promise<any>;
 *   selectedColor: string | null;
 *   onColorSelect: (color: string | null, product?: any, image?: any) => void;
 *   onColorsExtracted: (colorImageMap: Map<string, any>) => void;
 *   currentProductId: string;
 *   currentProduct: any;
 * }}
 */
function ProductColorSwatches({
  relatedProducts,
  selectedColor,
  onColorSelect,
  onColorsExtracted,
  currentProductId,
  currentProduct,
}) {
  return (
    <Suspense fallback={null}>
      <Await resolve={relatedProducts}>
        {(data) => {
          if (!data?.products?.nodes) {
            return null;
          }

          const allProducts = data.products.nodes;

          // Extract unique colors from all products (including current)
          const colorMap = new Map();
          // Map to store color code to image for fast lookup and preloading
          const colorImageMap = new Map();

          // First, add the current product to the map
          const currentColorCodeTag = currentProduct.tags?.find((tag) =>
            tag.startsWith('colorCode:'),
          );
          if (currentColorCodeTag) {
            const colorCode = currentColorCodeTag.replace('colorCode:', '').trim();
            // Extract color name from colorName tag, fallback to colorCode
            const colorNameTag = currentProduct.tags?.find((tag) =>
              tag.startsWith('colorName:'),
            );
            const colorName = colorNameTag
              ? colorNameTag.replace('colorName:', '').trim()
              : colorCode;
            const formattedColorCode = colorCode.startsWith('#')
              ? colorCode
              : `#${colorCode}`;
            const currentImage = currentProduct.selectedOrFirstAvailableVariant?.image;
            colorMap.set(colorCode, {
              code: colorCode,
              formattedCode: formattedColorCode,
              name: colorName,
              product: currentProduct,
              image: currentImage, // Store image directly
            });
            if (currentImage) {
              colorImageMap.set(colorCode, currentImage);
            }
          }

          // Then add all other products
          allProducts.forEach((product) => {
            const colorCodeTag = product.tags?.find((tag) =>
              tag.startsWith('colorCode:'),
            );

            if (colorCodeTag) {
              const colorCode = colorCodeTag.replace('colorCode:', '').trim();
              // Extract color name from colorName tag, fallback to colorCode
              const colorNameTag = product.tags?.find((tag) =>
                tag.startsWith('colorName:'),
              );
              const colorName = colorNameTag
                ? colorNameTag.replace('colorName:', '').trim()
                : colorCode;

              if (!colorMap.has(colorCode)) {
                const formattedColorCode = colorCode.startsWith('#')
                  ? colorCode
                  : `#${colorCode}`;
                const productImage = product.selectedOrFirstAvailableVariant?.image;
                colorMap.set(colorCode, {
                  code: colorCode,
                  formattedCode: formattedColorCode,
                  name: colorName,
                  product: product, // Store the product so we can use its image
                  image: productImage, // Store image directly
                });
                if (productImage) {
                  colorImageMap.set(colorCode, productImage);
                }
              }
            }
          });

          const colors = Array.from(colorMap.values());

          if (colors.length === 0) {
            return null;
          }

          // Notify parent component about extracted colors and images for caching
          if (onColorsExtracted) {
            onColorsExtracted(colorImageMap);
          }

          return (
            <div className="product-color-selector">
              <div className="color-selector-label">
                <label htmlFor="color-dropdown">Selected Color</label>
              </div>
              <ColorDropdown
                colors={colors}
                selectedColor={selectedColor}
                onColorSelect={onColorSelect}
              />
              <ColorSwatchSelectorWithPreload
                colors={colors}
                selectedColor={selectedColor}
                onColorSelect={onColorSelect}
              />
            </div>
          );
        }}
      </Await>
    </Suspense>
  );
}

/**
 * Color dropdown with search functionality
 * @param {{
 *   colors: Array<{code: string; name: string; product?: any; image?: any}>;
 *   selectedColor: string | null;
 *   onColorSelect: (color: string | null, product?: any, image?: any) => void;
 * }}
 */
function ColorDropdown({ colors, selectedColor, onColorSelect }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef(null);

  // Find the selected color object
  const selectedColorObj = colors.find((c) => c.code === selectedColor);
  const displayName = selectedColorObj?.name || 'Select a color';

  // Filter colors based on search term
  const filteredColors = colors.filter((color) =>
    color.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  const handleColorSelect = (color) => {
    onColorSelect(color.code, color.product, color.image);
    setIsOpen(false);
    setSearchTerm('');
  };

  return (
    <div className="color-dropdown-container" ref={dropdownRef}>
      <button
        type="button"
        className="color-dropdown-button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <div className="color-dropdown-selected">
          {selectedColorObj && (
            <span
              className="color-dropdown-swatch"
              style={{
                backgroundColor: selectedColorObj.formattedCode || `#${selectedColorObj.code}`,
              }}
            />
          )}
          <span className="color-dropdown-text">{displayName}</span>
        </div>
        <svg
          className={`color-dropdown-arrow ${isOpen ? 'open' : ''}`}
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {isOpen && (
        <div className="color-dropdown-menu">
          <div className="color-dropdown-search">
            <input
              type="text"
              placeholder="Search colors..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="color-dropdown-search-input"
              autoFocus
            />
          </div>
          <div className="color-dropdown-options">
            {filteredColors.length === 0 ? (
              <div className="color-dropdown-no-results">No colors found</div>
            ) : (
              filteredColors.map((color) => (
                <button
                  key={color.code}
                  type="button"
                  className={`color-dropdown-option ${selectedColor === color.code ? 'selected' : ''
                    }`}
                  onClick={() => handleColorSelect(color)}
                >
                  <span
                    className="color-dropdown-option-swatch"
                    style={{
                      backgroundColor: color.formattedCode || `#${color.code}`,
                    }}
                  />
                  <span className="color-dropdown-option-name">{color.name}</span>
                  {selectedColor === color.code && (
                    <svg
                      className="color-dropdown-check"
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M13 3L6 10l-3-3" />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Color swatch selector with image preloading
 * @param {{
 *   colors: Array<{code: string; name: string; product?: any; image?: any}>;
 *   selectedColor: string | null;
 *   onColorSelect: (color: string | null, product?: any, image?: any) => void;
 * }}
 */
function ColorSwatchSelectorWithPreload({ colors, selectedColor, onColorSelect }) {
  // Pre-load all images when component mounts or colors change
  useEffect(() => {
    colors.forEach((color) => {
      if (color.image?.url) {
        const img = new Image();
        img.src = color.image.url;
        // Optionally preload with higher priority
        if (document.createElement('link')) {
          const link = document.createElement('link');
          link.rel = 'preload';
          link.as = 'image';
          link.href = color.image.url;
          document.head.appendChild(link);
        }
      }
    });
  }, [colors]);

  return (
    <div className="product-color-swatches" style={{ marginBottom: '1rem' }}>
      <div className="color-swatch-selector">
        <div className="color-swatches">
          {colors.map((color) => (
            <button
              key={color.code}
              type="button"
              className={`color-swatch ${selectedColor === color.code ? 'selected' : ''
                }`}
              onClick={() => onColorSelect(color.code, color.product, color.image)}
              style={{
                backgroundColor: color.formattedCode || `#${color.code}`,
              }}
              aria-label={color.name}
              title={color.name}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const PRODUCT_VARIANT_FRAGMENT = `#graphql
  fragment ProductVariant on ProductVariant {
    availableForSale
    quantityAvailable
    compareAtPrice {
      amount
      currencyCode
    }
    id
    image {
      __typename
      id
      url
      altText
      width
      height
    }
    price {
      amount
      currencyCode
    }
    product {
      title
      handle
    }
    selectedOptions {
      name
      value
    }
    sku
    title
    unitPrice {
      amount
      currencyCode
    }
  }
`;

const PRODUCT_FRAGMENT = `#graphql
  fragment Product on Product {
    id
    title
    vendor
    handle
    tags
    descriptionHtml
    description
    encodedVariantExistence
    encodedVariantAvailability
    media(first: 10) {
      nodes {
        ... on MediaImage {
          id
          image {
            id
            url
            altText
            width
            height
          }
        }
      }
    }
    options {
      name
      optionValues {
        name
        firstSelectableVariant {
          ...ProductVariant
        }
        swatch {
          color
          image {
            previewImage {
              url
            }
          }
        }
      }
    }
    selectedOrFirstAvailableVariant(selectedOptions: $selectedOptions, ignoreUnknownOptions: true, caseInsensitiveMatch: true) {
      ...ProductVariant
    }
    adjacentVariants (selectedOptions: $selectedOptions) {
      ...ProductVariant
    }
    seo {
      description
      title
    }
  }
  ${PRODUCT_VARIANT_FRAGMENT}
`;

const PRODUCT_QUERY = `#graphql
  query Product(
    $country: CountryCode
    $handle: String!
    $language: LanguageCode
    $selectedOptions: [SelectedOptionInput!]!
  ) @inContext(country: $country, language: $language) {
    product(handle: $handle) {
      ...Product
    }
  }
  ${PRODUCT_FRAGMENT}
`;

const RELATED_PRODUCTS_QUERY = `#graphql
  fragment RelatedProduct on Product {
    id
    handle
    title
    tags
    encodedVariantExistence
    encodedVariantAvailability
    featuredImage {
      id
      altText
      url
      width
      height
    }
    priceRange {
      minVariantPrice {
        amount
        currencyCode
      }
    }
    options {
      name
      optionValues {
        name
        firstSelectableVariant {
          ...ProductVariant
        }
        swatch {
          color
          image {
            previewImage {
              url
            }
          }
        }
      }
    }
    selectedOrFirstAvailableVariant(
      selectedOptions: []
      ignoreUnknownOptions: true
      caseInsensitiveMatch: true
    ) {
      ...ProductVariant
    }
    adjacentVariants(selectedOptions: []) {
      ...ProductVariant
    }
  }
  query RelatedProducts($query: String!, $first: Int!) {
    products(first: $first, query: $query) {
      nodes {
        ...RelatedProduct
      }
    }
  }
  ${PRODUCT_VARIANT_FRAGMENT}
`;

/** @typedef {import('./+types/products.$handle').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */
