export type OrderedProductImage = { id: number };

export function productImageOrderPayload(images: OrderedProductImage[]) {
  return {
    images: images.map((image, order) => ({ id: image.id, order })),
  };
}
