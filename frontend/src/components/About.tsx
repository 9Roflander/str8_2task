import React from "react";
import { invoke } from '@tauri-apps/api/core';
import Image from 'next/image';
import AnalyticsConsentSwitch from "./AnalyticsConsentSwitch";


export function About() {
    const handleContactClick = async () => {
        try {
            await invoke('open_external_url', { url: 'https://str8_2task.zackriya.com/#about' });
        } catch (error) {
            console.error('Failed to open link:', error);
        }
    };

    return (
        <div className="p-4 space-y-4 h-[80vh] overflow-y-auto">
            {/* Header */}
            <div className="text-center">
                <div className="mb-3">
                    <Image 
                        src="/logo.jpg" 
                        alt="str8_2task Logo" 
                        width={128} 
                        height={128}
                        className="mx-auto rounded"
                    />
                </div>
                <h1 className="text-xl font-bold text-gray-900 mb-1">str8_2task</h1>
                <span className="text-sm text-gray-500">v0.1.1</span>
            </div>

            {/* Functionality List */}
            <div className="space-y-3">
                <h2 className="text-base font-semibold text-gray-800">Application Features</h2>
                <div className="space-y-2">
                    <div className="bg-gray-50 rounded p-3">
                        <h3 className="font-semibold text-sm text-gray-900 mb-1">🎙️ Audio Capture</h3>
                        <p className="text-xs text-gray-600">Record system audio from selected applications or capture all system audio. Works with any meeting platform (Zoom, Teams, Google Meet, etc.)</p>
                    </div>
                    <div className="bg-gray-50 rounded p-3">
                        <h3 className="font-semibold text-sm text-gray-900 mb-1">🎤 Microphone Control</h3>
                        <p className="text-xs text-gray-600">Mute and unmute your microphone during recording without stopping the session</p>
                    </div>
                    <div className="bg-gray-50 rounded p-3">
                        <h3 className="font-semibold text-sm text-gray-900 mb-1">📝 Real-time Transcription</h3>
                        <p className="text-xs text-gray-600">Live transcription using Whisper or Parakeet models with GPU acceleration support</p>
                    </div>
                    <div className="bg-gray-50 rounded p-3">
                        <h3 className="font-semibold text-sm text-gray-900 mb-1">🤖 AI-Powered Summaries</h3>
                        <p className="text-xs text-gray-600">Generate intelligent meeting summaries with key points, action items, decisions, and main topics</p>
                    </div>
                    <div className="bg-gray-50 rounded p-3">
                        <h3 className="font-semibold text-sm text-gray-900 mb-1">✏️ Rich Text Editor</h3>
                        <p className="text-xs text-gray-600">Edit summaries with BlockNote editor - format text, add headings, bullets, and more</p>
                    </div>
                    <div className="bg-gray-50 rounded p-3">
                        <h3 className="font-semibold text-sm text-gray-900 mb-1">❓ Smart Question Generation</h3>
                        <p className="text-xs text-gray-600">Automatically generates clarifying questions about missing information, deadlines, and action items</p>
                    </div>
                    <div className="bg-gray-50 rounded p-3">
                        <h3 className="font-semibold text-sm text-gray-900 mb-1">🔗 Jira Integration</h3>
                        <p className="text-xs text-gray-600">Create Jira tasks directly from meeting summaries and action items</p>
                    </div>
                    <div className="bg-gray-50 rounded p-3">
                        <h3 className="font-semibold text-sm text-gray-900 mb-1">🎯 Multiple LLM Providers</h3>
                        <p className="text-xs text-gray-600">Support for Ollama (local), Groq, Claude, OpenAI, OpenRouter, and Gemini models</p>
                    </div>
                    <div className="bg-gray-50 rounded p-3">
                        <h3 className="font-semibold text-sm text-gray-900 mb-1">📋 Summary Templates</h3>
                        <p className="text-xs text-gray-600">Use pre-built templates or create custom summary formats for different meeting types</p>
                    </div>
                    <div className="bg-gray-50 rounded p-3">
                        <h3 className="font-semibold text-sm text-gray-900 mb-1">💾 Meeting Management</h3>
                        <p className="text-xs text-gray-600">Organize meetings, transcripts, and summaries. Search and filter your meeting history</p>
                    </div>
                    <div className="bg-gray-50 rounded p-3">
                        <h3 className="font-semibold text-sm text-gray-900 mb-1">🔒 Complete Privacy</h3>
                        <p className="text-xs text-gray-600">All processing happens locally on your device. No data leaves your machine</p>
                    </div>
                    <div className="bg-gray-50 rounded p-3">
                        <h3 className="font-semibold text-sm text-gray-900 mb-1">⚡ GPU Acceleration</h3>
                        <p className="text-xs text-gray-600">Leverage your GPU for faster transcription and summary generation (Metal on macOS)</p>
                    </div>
                </div>
            </div>

            <AnalyticsConsentSwitch />
        </div>

    )
}