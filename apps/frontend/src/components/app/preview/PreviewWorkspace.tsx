'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { PreviewStatus, ViewportClass, CustomizationConfig } from '@craft/types';
import { PreviewControls } from './PreviewControls';
import { PreviewIframe } from './PreviewIframe';
import { usePreviewService } from '@/hooks/usePreviewService';
import { LoadingSkeleton } from '../LoadingSkeleton';
import { ErrorState } from '../ErrorState';

interface PreviewWorkspaceProps {
  readonly templateId?: string;
  readonly customization?: CustomizationConfig;
  readonly className?: string;
}

export function PreviewWorkspace({ 
  templateId, 
  customization, 
  className = '' 
}: PreviewWorkspaceProps) {
  const [activeViewport, setActiveViewport] = useState<ViewportClass>('desktop');
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sequenceRef = useRef(0);
  const { generatePreview, refreshPreview } = usePreviewService();

  const handleViewportChange = useCallback((viewport: ViewportClass) => {
    setActiveViewport(viewport);
    setPreviewStatus('loading');
  }, []);

  const handleRefresh = useCallback(async () => {
    if (!customization) return;

    const requestId = ++sequenceRef.current;

    setIsRefreshing(true);
    setError(null);

    try {
      await refreshPreview(customization, activeViewport);
      if (requestId !== sequenceRef.current) return;
      setPreviewStatus('ready');
    } catch (err) {
      if (requestId !== sequenceRef.current) return;
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to refresh preview');
      setPreviewStatus('error');
    } finally {
      if (requestId === sequenceRef.current) {
        setIsRefreshing(false);
      }
    }
  }, [customization, activeViewport, refreshPreview]);

  const handleRetry = useCallback(() => {
    setError(null);
    setPreviewStatus('loading');
    handleRefresh();
  }, [handleRefresh]);

  useEffect(() => {
    if (customization) {
      handleRefresh();
    }
    return () => {
      sequenceRef.current += 1;
    };
  }, [customization, activeViewport, handleRefresh]);

  const renderPreviewContent = () => {
    switch (previewStatus) {
      case 'loading':
        return <LoadingSkeleton />;
      
      case 'error':
        return (
          <ErrorState
            title="Preview Failed"
            description={error || 'Unable to load preview'}
            onRetry={handleRetry}
          />
        );
      
      case 'ready':
        return (
          <PreviewIframe
            ref={iframeRef}
            templateId={templateId}
            customization={customization}
            viewport={activeViewport}
            onLoad={() => setPreviewStatus('ready')}
            onError={(err) => {
              setError(err.message);
              setPreviewStatus('error');
            }}
          />
        );
      
      default:
        return null;
    }
  };

  return (
    <div className={`flex flex-col h-full bg-gray-50 ${className}`}>
      <PreviewControls
        activeViewport={activeViewport}
        onViewportChange={handleViewportChange}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        status={previewStatus}
      />
      
      <div className="flex-1 relative overflow-hidden">
        {renderPreviewContent()}
      </div>
    </div>
  );
}
