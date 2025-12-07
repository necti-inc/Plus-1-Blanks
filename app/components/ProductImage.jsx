import { useState, useEffect } from 'react';
import { Image } from '@shopify/hydrogen';

/**
 * @param {{
 *   images?: Array<ProductVariantFragment['image']>;
 *   image?: ProductVariantFragment['image']; // Legacy support
 * }}
 */
export function ProductImage({ images, image }) {
  // Support both new images array and legacy single image prop
  const imageArray = images || (image ? [image] : []);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // Reset to first image when images change (e.g., color selection)
  useEffect(() => {
    setCurrentImageIndex(0);
  }, [imageArray.length, imageArray[0]?.id]);

  if (imageArray.length === 0) {
    return <div className="product-image" />;
  }

  const currentImage = imageArray[currentImageIndex];
  const hasMultipleImages = imageArray.length > 1;

  const goToPrevious = () => {
    setCurrentImageIndex((prev) => 
      prev === 0 ? imageArray.length - 1 : prev - 1
    );
  };

  const goToNext = () => {
    setCurrentImageIndex((prev) => 
      prev === imageArray.length - 1 ? 0 : prev + 1
    );
  };

  return (
    <div className="product-image-container">
      <div className="product-image">
        <Image
          alt={currentImage.altText || 'Product Image'}
          aspectRatio="1/1"
          data={currentImage}
          key={currentImage.id}
          sizes="(min-width: 45em) 50vw, 100vw"
        />
        {hasMultipleImages && (
          <>
            <button
              type="button"
              className="product-image-nav product-image-nav-prev"
              onClick={goToPrevious}
              aria-label="Previous image"
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              className="product-image-nav product-image-nav-next"
              onClick={goToNext}
              aria-label="Next image"
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** @typedef {import('storefrontapi.generated').ProductVariantFragment} ProductVariantFragment */
