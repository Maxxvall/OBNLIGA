declare module 'html-to-image' {
  export interface HtmlToImageOptions {
    cacheBust?: boolean
    pixelRatio?: number
    backgroundColor?: string
    canvasHeight?: number
    canvasWidth?: number
    filter?: (domNode: HTMLElement) => boolean
    skipAutoScale?: boolean
    style?: Partial<CSSStyleDeclaration>
  }

  export function toBlob(
    node: HTMLElement,
    options?: HtmlToImageOptions
  ): Promise<Blob | null>
}
