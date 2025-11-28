/**
 * Hook for managing browser extension connection status
 * 
 * Provides functions to:
 * - Check if the browser extension is connected
 * - Send messages to the meeting chat
 * - Send multiple questions with delays
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface ExtensionStatus {
    connected_extensions: number;
    connections: Array<{
        id: string;
        connected_at: string;
        last_activity: string;
        platform?: string;
        meeting_active?: boolean;
    }>;
    pending_messages: number;
}

interface SendResult {
    success: boolean;
    sent_to?: number;
    total_connections?: number;
    queued?: boolean;
    error?: string;
}

interface SendQuestionsResult {
    success: boolean;
    sent: number;
    total: number;
    results?: Array<{
        question: string;
        result: SendResult;
    }>;
}

export function useExtensionConnection() {
    const [isConnected, setIsConnected] = useState(false);
    const [status, setStatus] = useState<ExtensionStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    
    // Polling interval ref
    const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

    /**
     * Fetch the current extension connection status
     */
    const checkStatus = useCallback(async () => {
        try {
            const response = await invoke('api_get_extension_status') as ExtensionStatus;
            setStatus(response);
            setIsConnected(response.connected_extensions > 0);
            setError(null);
        } catch (err: any) {
            console.error('Failed to check extension status:', err);
            setError(err.message || 'Failed to check extension status');
            setIsConnected(false);
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Send a single message to the meeting chat
     */
    const sendToChat = useCallback(async (message: string, platform?: string): Promise<SendResult> => {
        try {
            const result = await invoke('api_send_to_chat', {
                request: {
                    message,
                    platform: platform || null
                }
            }) as SendResult;
            return result;
        } catch (err: any) {
            console.error('Failed to send message to chat:', err);
            return {
                success: false,
                error: err.message || 'Failed to send message'
            };
        }
    }, []);

    /**
     * Send multiple questions to the meeting chat with delays
     */
    const sendQuestions = useCallback(async (
        questions: string[],
        delayBetween: number = 2.0,
        platform?: string
    ): Promise<SendQuestionsResult> => {
        try {
            const result = await invoke('api_send_questions_to_chat', {
                request: {
                    questions,
                    delay_between: delayBetween,
                    platform: platform || null
                }
            }) as SendQuestionsResult;
            return result;
        } catch (err: any) {
            console.error('Failed to send questions to chat:', err);
            return {
                success: false,
                sent: 0,
                total: questions.length
            };
        }
    }, []);

    /**
     * Ping all connected extensions
     */
    const pingExtensions = useCallback(async () => {
        try {
            await invoke('api_ping_extensions');
            // Refresh status after ping
            await checkStatus();
        } catch (err: any) {
            console.error('Failed to ping extensions:', err);
        }
    }, [checkStatus]);

    // Poll for status updates
    useEffect(() => {
        // Initial check
        checkStatus();

        // Set up polling interval (every 10 seconds)
        pollIntervalRef.current = setInterval(() => {
            checkStatus();
        }, 10000);

        return () => {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
            }
        };
    }, [checkStatus]);

    return {
        isConnected,
        status,
        loading,
        error,
        checkStatus,
        sendToChat,
        sendQuestions,
        pingExtensions
    };
}





