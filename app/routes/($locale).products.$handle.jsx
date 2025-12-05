import {useState} from 'react';
import {Suspense} from 'react';
import {useLoaderData, Await} from 'react-router';
import {
  getSelectedProductOptions,
  Analytics,
  useOptimisticVariant,
  getProductOptions,
  getAdjacentAndFirstAvailableVariants,
  useSelectedOptionInUrlParam,
} from '@shopify/hydrogen';
import {ProductPrice} from '~/components/ProductPrice';
import {ProductImage} from '~/components/ProductImage';
import {ProductForm} from '~/components/ProductForm';
import {ProductItem} from '~/components/ProductItem';
import {redirectIfHandleIsLocalized} from '~/lib/redirect';

/**
 * @type {Route.MetaFunction}
 */
export const meta = ({data}) => {
  return [
    {title: `Hydrogen | ${data?.product.title ?? ''}`},
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

  return {...deferredData, ...criticalData};
}

/**
 * Load data necessary for rendering content above the fold. This is the critical data
 * needed to render the page. If it's unavailable, the whole page should 400 or 500 error.
 * @param {Route.LoaderArgs}
 */
async function loadCriticalData({context, params, request}) {
  const {handle} = params;
  const {storefront} = context;

  if (!handle) {
    throw new Error('Expected product handle to be defined');
  }

  const [{product}] = await Promise.all([
    storefront.query(PRODUCT_QUERY, {
      variables: {handle, selectedOptions: getSelectedProductOptions(request)},
    }),
    // Add other queries here, so that they are loaded in parallel
  ]);

  if (!product?.id) {
    throw new Response(null, {status: 404});
  }

  // The API handle might be localized, so redirect to the localized handle
  redirectIfHandleIsLocalized(request, {handle, data: product});

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
function loadDeferredData({context, params, request}) {
  const {handle} = params;
  const {storefront} = context;

  // Create a promise chain that:
  // 1. First gets the current product to find its ProductID tag
  // 2. Then searches for related products
  const relatedProducts = storefront
    .query(PRODUCT_QUERY, {
      variables: {handle, selectedOptions: getSelectedProductOptions(request)},
    })
    .then(({product: currentProduct}) => {
      console.log('Current Product:', currentProduct);
      console.log('Current Product Tags:', currentProduct?.tags);

      if (!currentProduct?.id) {
        console.log('No current product ID found');
        return {products: {nodes: []}};
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
        return {products: {nodes: []}};
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
      return result || {products: {nodes: []}};
    })
    .catch((error) => {
      console.error('Error fetching related products:', error);
      // Return empty result instead of null to prevent rendering issues
      return {products: {nodes: []}};
    });

  return {
    relatedProducts,
  };
}

export default function Product() {
  /** @type {LoaderReturnData} */
  const {product, relatedProducts} = useLoaderData();
  
  // Get current product's colorCode to initialize selected color
  const currentColorCodeTag = product.tags?.find((tag) =>
    tag.startsWith('colorCode:'),
  );
  const initialColorCode = currentColorCodeTag
    ? currentColorCodeTag.replace('colorCode:', '').trim()
    : null;

  const [selectedColor, setSelectedColor] = useState(initialColorCode);
  const [selectedColorProduct, setSelectedColorProduct] = useState(product);
  
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

  const {title, descriptionHtml} = product;

  // Determine which image to show - use selected color product image if available, otherwise use selected variant
  const displayImage = selectedColorProduct?.selectedOrFirstAvailableVariant?.image || selectedVariant?.image;
  
  console.log('Display Image:', displayImage);
  console.log('Selected Color Product:', selectedColorProduct);
  console.log('Selected Color Product Image:', selectedColorProduct?.selectedOrFirstAvailableVariant?.image);

  return (
    <>
      <div className="product">
        <ProductImage image={displayImage} />
        <div className="product-main">
          <h1>{title}</h1>
          {relatedProducts && (
            <ProductColorSwatches
              relatedProducts={relatedProducts}
              selectedColor={selectedColor}
              onColorSelect={(color, product) => {
                console.log('Color selected:', color, 'Product:', product);
                console.log('Product image:', product?.selectedOrFirstAvailableVariant?.image);
                setSelectedColor(color);
                setSelectedColorProduct(product);
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
          />
          <br />
          <br />
          <p>
            <strong>Description</strong>
          </p>
          <br />
          <div dangerouslySetInnerHTML={{__html: descriptionHtml}} />
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
              const colorName =
                product.selectedOrFirstAvailableVariant?.selectedOptions?.find(
                  (opt) => opt.name === 'Color' || opt.name === 'Colour',
                )?.value || colorCode;
              console.log('Color extracted:', {colorCode, colorName});
              
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
 * @param {{
 *   colors: Array<{code: string; name: string; product?: any}>;
 *   selectedColor: string | null;
 *   onColorSelect: (color: string | null, product?: any) => void;
 * }}
 */
function ColorSwatchSelector({colors, selectedColor, onColorSelect}) {
  return (
    <div className="color-swatch-selector">
      <div className="color-swatches">
        {colors.map((color) => (
          <button
            key={color.code}
            type="button"
            className={`color-swatch ${
              selectedColor === color.code ? 'selected' : ''
            }`}
            onClick={() => onColorSelect(color.code, color.product)}
            style={{
              backgroundColor: color.formattedCode || `#${color.code}`,
            }}
            aria-label={color.name}
            title={color.name}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Component to display color swatches in the main product area
 * @param {{
 *   relatedProducts: Promise<any>;
 *   selectedColor: string | null;
 *   onColorSelect: (color: string | null, product?: any) => void;
 *   currentProductId: string;
 *   currentProduct: any;
 * }}
 */
function ProductColorSwatches({
  relatedProducts,
  selectedColor,
  onColorSelect,
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
          
          // First, add the current product to the map
          const currentColorCodeTag = currentProduct.tags?.find((tag) =>
            tag.startsWith('colorCode:'),
          );
          if (currentColorCodeTag) {
            const colorCode = currentColorCodeTag.replace('colorCode:', '').trim();
            const colorName =
              currentProduct.selectedOrFirstAvailableVariant?.selectedOptions?.find(
                (opt) => opt.name === 'Color' || opt.name === 'Colour',
              )?.value || colorCode;
            const formattedColorCode = colorCode.startsWith('#')
              ? colorCode
              : `#${colorCode}`;
            colorMap.set(colorCode, {
              code: colorCode,
              formattedCode: formattedColorCode,
              name: colorName,
              product: currentProduct,
            });
          }
          
          // Then add all other products
          allProducts.forEach((product) => {
            const colorCodeTag = product.tags?.find((tag) =>
              tag.startsWith('colorCode:'),
            );
            
            if (colorCodeTag) {
              const colorCode = colorCodeTag.replace('colorCode:', '').trim();
              const colorName =
                product.selectedOrFirstAvailableVariant?.selectedOptions?.find(
                  (opt) => opt.name === 'Color' || opt.name === 'Colour',
                )?.value || colorCode;
              
              if (!colorMap.has(colorCode)) {
                const formattedColorCode = colorCode.startsWith('#')
                  ? colorCode
                  : `#${colorCode}`;
                colorMap.set(colorCode, {
                  code: colorCode,
                  formattedCode: formattedColorCode,
                  name: colorName,
                  product: product, // Store the product so we can use its image
                });
              }
            }
          });

          const colors = Array.from(colorMap.values());

          if (colors.length === 0) {
            return null;
          }

          return (
            <div className="product-color-swatches" style={{marginBottom: '1rem'}}>
              <ColorSwatchSelector
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

const PRODUCT_VARIANT_FRAGMENT = `#graphql
  fragment ProductVariant on ProductVariant {
    availableForSale
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
    selectedOrFirstAvailableVariant(
      selectedOptions: []
      ignoreUnknownOptions: true
      caseInsensitiveMatch: true
    ) {
      id
      image {
        __typename
        id
        url
        altText
        width
        height
      }
      selectedOptions {
        name
        value
      }
    }
  }
  query RelatedProducts($query: String!, $first: Int!) {
    products(first: $first, query: $query) {
      nodes {
        ...RelatedProduct
      }
    }
  }
`;

/** @typedef {import('./+types/products.$handle').Route} Route */
/** @typedef {import('@shopify/remix-oxygen').SerializeFrom<typeof loader>} LoaderReturnData */
