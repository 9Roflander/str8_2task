import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RefreshCw, CheckSquare, Square } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface AppSelectorProps {
  selectedApps: string[];
  onAppsChange: (apps: string[]) => void;
}

export function AppSelector({ selectedApps, onAppsChange }: AppSelectorProps) {
  const [availableApps, setAvailableApps] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadApps = async () => {
    setLoading(true);
    try {
      const apps = await invoke<string[]>('get_apps_using_audio');
      // Remove duplicates and sort
      const uniqueApps = Array.from(new Set(apps)).sort();
      setAvailableApps(uniqueApps);
    } catch (error) {
      console.error('Failed to load apps using audio:', error);
      toast.error('Failed to load apps');
      setAvailableApps([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadApps();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadApps();
    setRefreshing(false);
    toast.success('Apps refreshed');
  };

  const handleAppToggle = (appName: string) => {
    const isSelected = selectedApps.includes(appName);
    if (isSelected) {
      onAppsChange(selectedApps.filter(app => app !== appName));
    } else {
      onAppsChange([...selectedApps, appName]);
    }
  };

  const handleSelectAll = () => {
    if (selectedApps.length === availableApps.length) {
      onAppsChange([]);
    } else {
      onAppsChange([...availableApps]);
    }
  };

  if (loading && availableApps.length === 0) {
    return (
      <div className="space-y-2">
        <Label>Filter System Audio by App</Label>
        <div className="text-sm text-muted-foreground">Loading apps...</div>
      </div>
    );
  }

  const allSelected = availableApps.length > 0 && selectedApps.length === availableApps.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Filter System Audio by App</Label>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          className="h-8 w-8 p-0"
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
        </Button>
      </div>
      
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSelectAll}
            className="text-xs"
          >
            {allSelected ? (
              <>
                <CheckSquare className="h-3 w-3 mr-1" />
                Deselect All
              </>
            ) : (
              <>
                <Square className="h-3 w-3 mr-1" />
                Select All
              </>
            )}
          </Button>
          <span className="text-xs text-muted-foreground">
            {selectedApps.length === 0
              ? 'No filter (all apps)'
              : `${selectedApps.length} of ${availableApps.length} selected`}
          </span>
        </div>

        {availableApps.length > 0 ? (
          <ScrollArea className="h-48 border rounded-md p-2">
            <div className="space-y-1">
              {availableApps.map((app) => {
                const isSelected = selectedApps.includes(app);
                return (
                  <label
                    key={app}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-accent transition-colors",
                      isSelected && "bg-accent"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleAppToggle(app)}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">{app}</span>
                  </label>
                );
              })}
            </div>
          </ScrollArea>
        ) : (
          <div className="h-48 border rounded-md flex items-center justify-center">
            <p className="text-sm text-muted-foreground">No apps using audio found</p>
          </div>
        )}

        {selectedApps.length > 0 && (
          <div className="flex flex-wrap gap-2 p-2 bg-muted rounded-md">
            {selectedApps.map((app) => (
              <div
                key={app}
                className="flex items-center gap-1 px-2 py-1 bg-background rounded-md text-sm border"
              >
                <span>{app}</span>
                <button
                  onClick={() => handleAppToggle(app)}
                  className="ml-1 text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${app}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {selectedApps.length === 0
            ? 'Recording will capture audio from all apps using system audio.'
            : `Recording will only capture audio from the selected ${selectedApps.length} app${selectedApps.length > 1 ? 's' : ''}.`}
        </p>
      </div>
    </div>
  );
}

