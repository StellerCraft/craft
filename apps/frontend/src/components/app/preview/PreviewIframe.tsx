'use client';

import React, { forwardRef, useEffect, useState } from 'react';
import { ViewportClass, VIEWPORT_DIMENSIONS, CustomizationConfig } from '@craft/types';

interface PreviewIframeProps {
  readonly templateId?: string;
  readonly customization?: CustomizationConfig;
  readonly viewport: ViewportClass;
  readonly onLoad?: () => void;
  readonly onError?: (error: Error) => void;
}

export const PreviewIframe = forwardRef<HTMLIFrameElement, PreviewIframeProps>(
  ({ templateId, customization, viewport, onLoad, onError }, ref) => {
    const [isLoading, setIsLoading] = useState(true);
    const [src, setSrc] = useState<string>('');

    useEffect(() => {
      const generatePreviewUrl = async () => {
        try {
          setIsLoading(true);
          
          // Build the preview URL with viewport and customization parameters
          const params = new URLSearchParams({
            viewport,
            templateId: templateId || 'default',
            timestamp: Date.now().toString(),
          });

          if (customization) {
            params.append('customization', JSON.stringify(customization));
          }

          const previewUrl = `/api/preview?${params.toString()}`;
          setSrc(previewUrl);
        } catch (error) {
          console.error('Failed to generate preview URL:', error);
          onError?.(error instanceof Error ? error : new Error('Failed to generate preview'));
        }
      };

      generatePreviewUrl();
    }, [templateId, customization, viewport, onError]);

    const handleIframeLoad = () => {
      setIsLoading(false);
      onLoad?.();
    };

    const handleIframeError = () => {
      setIsLoading(false);
      const error = new Error('Failed to load preview iframe');
      onError?.(error);
    };

    const dimensions = VIEWPORT_DIMENSIONS[viewport];
    
    return (
      <div className="flex items-center justify-center h-full p-8 bg-gray-50">
        <div 
          className="relative bg-white shadow-lg border border-gray-200 rounded-lg overflow-hidden"
          style={{
            width: `${dimensions.width}px`,
            height: `${dimensions.height}px`,
            maxWidth: '100%',
            maxHeight: '100%',
          }}
        >
          {/* Loading overlay */}
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-90 z-10">
              <div className="flex flex-col items-center space-y-3">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <span className="text-sm text-gray-600">Loading preview...</span>
              </div>
            </div>
          )}

          {/* Viewport label */}
          <div className="absolute top-2 left-2 z-20">
            <span className="px-2 py-1 text-xs font-medium bg-gray-900 bg-opacity-75 text-white rounded">
              {viewport} ({dimensions.width}×{dimensions.height})
            </span>
          </div>

          {/* Iframe */}
          <iframe
            ref={ref}
            src={src}
            onLoad={handleIframeLoad}
            onError={handleIframeError}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            loading="lazy"
            title={`Preview for ${viewport} viewport`}
            aria-label={`Preview of template ${templateId || 'default'} in ${viewport} mode`}
          />
        </div>
      </div>
    );
  }
);

PreviewIframe.displayName = 'PreviewIframe';
