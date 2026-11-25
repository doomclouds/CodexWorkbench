export interface MediaSize {
  readonly width: number;
  readonly height: number;
}

export interface ImageCrop {
  readonly zoom: number;
  readonly x: number;
  readonly y: number;
}

export interface ImageCropPatch {
  readonly crop: ImageCrop;
  readonly naturalSize: MediaSize;
}

export type MediaObjectStatus =
  | { readonly status: 'ready' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message?: string };

interface MediaObjectBaseProps {
  readonly src?: string;
  readonly label: string;
  readonly interactive?: boolean;
  readonly status?: MediaObjectStatus;
}

export interface ImageObjectProps extends MediaObjectBaseProps, MediaSize {
  readonly kind: 'image';
  readonly crop?: ImageCrop;
  readonly naturalSize?: MediaSize;
  readonly href?: string;
  readonly locked?: boolean;
  readonly readOnly?: boolean;
  readonly editRequest?: number;
  readonly onCropActivityChange?: (active: boolean) => void;
  readonly onSaveCrop?: SaveImageCrop;
}

export interface VideoObjectProps extends MediaObjectBaseProps {
  readonly kind: 'video';
  readonly poster?: string;
}

export type SaveImageCrop = (patch: ImageCropPatch) => Promise<boolean | void>;

export type MediaObjectProps = ImageObjectProps | VideoObjectProps;

export interface LinkObjectProps {
  readonly label?: string;
  readonly href?: string;
  readonly interactive?: boolean;
}
