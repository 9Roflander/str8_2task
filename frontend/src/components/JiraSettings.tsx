import React, { useState, useEffect } from 'react';
import { Save, CheckCircle, AlertCircle, Loader2, Link } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface JiraConfig {
    url: string;
    email: string;
    api_token: string;
    default_project_key?: string;
    default_issue_type?: string;
}

const isValidEmail = (email: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const isValidUrl = (url: string): boolean => {
    try {
        new URL(url);
        return url.includes('atlassian.net') || url.includes('jira');
    } catch {
        return false;
    }
};

export function JiraSettings() {
    const [config, setConfig] = useState<JiraConfig>({
        url: '',
        email: '',
        api_token: '',
        default_project_key: '',
        default_issue_type: ''
    });
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);
    const [validationErrors, setValidationErrors] = useState<{ url?: string; email?: string; api_token?: string }>({});
    const [hasExistingConfig, setHasExistingConfig] = useState(false);

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        try {
            setLoading(true);
            const savedConfig = await invoke('api_get_jira_config') as JiraConfig;
            if (savedConfig && savedConfig.url) {
                setConfig(savedConfig);
                setHasExistingConfig(true);
            } else {
                setHasExistingConfig(false);
            }
        } catch (error) {
            console.error('Failed to load Jira config:', error);
            setHasExistingConfig(false);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (e?: React.MouseEvent) => {
        e?.preventDefault();
        e?.stopPropagation();
        console.log('Save button clicked', { config, hasExistingConfig });
        
        // Validate inputs
        const errors: { url?: string; email?: string } = {};
        if (!isValidUrl(config.url)) {
            errors.url = 'Please enter a valid Jira URL (e.g., https://your-domain.atlassian.net)';
        }
        if (!isValidEmail(config.email)) {
            errors.email = 'Please enter a valid email address';
        }

        if (Object.keys(errors).length > 0) {
            setValidationErrors(errors);
            return;
        }

        setValidationErrors({});

        // Validate API token - only require it for new configurations
        // If it's '********' or empty and we have existing config, we'll keep the existing token
        if (!hasExistingConfig && (!config.api_token || config.api_token.trim() === '' || config.api_token === '********')) {
            setValidationErrors({ 
                ...validationErrors, 
                api_token: 'Please enter your API token for new configuration.' 
            });
            return;
        }

        try {
            setSaving(true);
            setStatus(null);

            // If token is masked, send undefined so backend keeps existing token
            const apiTokenToSend = (config.api_token === '********' || config.api_token.trim() === '') 
                ? undefined 
                : config.api_token;
            
            const response = await invoke('api_save_jira_config', {
                config: {
                    url: config.url,
                    email: config.email,
                    api_token: apiTokenToSend,
                    default_project_key: config.default_project_key || undefined,
                    default_issue_type: config.default_issue_type || undefined
                }
            }) as any;

            if (response.status === 'success') {
                setStatus({ type: 'success', message: response.message });
            } else {
                setStatus({ type: 'warning', message: response.message });
            }
        } catch (error: any) {
            console.error('Failed to save Jira config:', error);
            const errorMessage = error.message || error.toString() || 'Failed to save configuration';
            // Check if it's a connection error
            if (errorMessage.includes('connection') || errorMessage.includes('Failed to connect') || errorMessage.includes('Connection refused')) {
                setStatus({ 
                    type: 'error', 
                    message: 'Cannot connect to backend server. Please ensure the backend is running on http://localhost:5167' 
                });
            } else {
                setStatus({ type: 'error', message: errorMessage });
            }
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                <p className="ml-3 text-gray-600">Loading configuration...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-lg font-semibold text-gray-900">Jira Integration</h2>
                <p className="text-sm text-gray-500 mt-1">
                    Connect your Jira account to automatically create tasks from meeting transcripts.
                </p>
            </div>

            <div className="grid gap-6 max-w-2xl">
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                        Jira Site URL
                    </label>
                    <input
                        type="url"
                        value={config.url}
                        onChange={(e) => setConfig({ ...config, url: e.target.value })}
                        placeholder="https://your-domain.atlassian.net"
                        className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 ${validationErrors.url ? 'border-red-300' : 'border-gray-300'
                            }`}
                    />
                    {validationErrors.url ? (
                        <p className="text-xs text-red-600">{validationErrors.url}</p>
                    ) : (
                        <p className="text-xs text-gray-500">The URL of your Jira Cloud instance</p>
                    )}
                </div>

                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                        Email Address
                    </label>
                    <input
                        type="email"
                        value={config.email}
                        onChange={(e) => setConfig({ ...config, email: e.target.value })}
                        placeholder="you@company.com"
                        className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 ${validationErrors.email ? 'border-red-300' : 'border-gray-300'
                            }`}
                    />
                    {validationErrors.email ? (
                        <p className="text-xs text-red-600">{validationErrors.email}</p>
                    ) : (
                        <p className="text-xs text-gray-500">The email address you use to log in to Jira</p>
                    )}
                </div>

                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                        API Token
                    </label>
                    <input
                        type="password"
                        value={config.api_token}
                        onChange={(e) => {
                            setConfig({ ...config, api_token: e.target.value });
                            // Clear validation error when user starts typing
                            if (validationErrors.api_token) {
                                setValidationErrors({ ...validationErrors, api_token: undefined });
                            }
                        }}
                        placeholder="Enter your API token"
                        className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 ${validationErrors.api_token ? 'border-red-300' : 'border-gray-300'}`}
                    />
                    {validationErrors.api_token && (
                        <p className="text-xs text-red-600">{validationErrors.api_token}</p>
                    )}
                    <p className="text-xs text-gray-500">
                        Create an API token at{' '}
                        <a
                            href="https://id.atlassian.com/manage-profile/security/api-tokens"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                        >
                            id.atlassian.com
                        </a>
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700">
                            Default Project Key (Optional)
                        </label>
                        <input
                            type="text"
                            value={config.default_project_key || ''}
                            onChange={(e) => setConfig({ ...config, default_project_key: e.target.value })}
                            placeholder="e.g. PROJ"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700">
                            Default Issue Type (Optional)
                        </label>
                        <input
                            type="text"
                            value={config.default_issue_type || ''}
                            onChange={(e) => setConfig({ ...config, default_issue_type: e.target.value })}
                            placeholder="e.g. Task"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>
                </div>

                {status && (
                    <div className={`p-4 rounded-md flex items-start gap-3 ${status.type === 'success' ? 'bg-green-50 text-green-800' :
                        status.type === 'warning' ? 'bg-yellow-50 text-yellow-800' :
                            'bg-red-50 text-red-800'
                        }`}>
                        {status.type === 'success' ? <CheckCircle className="w-5 h-5 mt-0.5" /> :
                            status.type === 'warning' ? <AlertCircle className="w-5 h-5 mt-0.5" /> :
                                <AlertCircle className="w-5 h-5 mt-0.5" />}
                        <div>
                            <p className="font-medium">{status.type === 'success' ? 'Success' : status.type === 'warning' ? 'Warning' : 'Error'}</p>
                            <p className="text-sm mt-1">{status.message}</p>
                        </div>
                    </div>
                )}

                <div className="flex justify-end pt-4">
                    <button
                        onClick={handleSave}
                        disabled={saving || !config.url || !config.email || (!config.api_token && !hasExistingConfig)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {saving ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Saving & Testing...
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4" />
                                Save & Test Connection
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
