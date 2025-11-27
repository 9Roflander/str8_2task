"use client";
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Summary, SummaryResponse } from '@/types';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import Analytics from '@/lib/analytics';
import { TranscriptPanel } from '@/components/MeetingDetails/TranscriptPanel';
import { SummaryPanel } from '@/components/MeetingDetails/SummaryPanel';
import { JiraPanel } from '@/components/MeetingDetails/JiraPanel';
import { SparkleIcon, Link } from 'lucide-react';

// Custom hooks
import { useMeetingData } from '@/hooks/meeting-details/useMeetingData';
import { useSummaryGeneration } from '@/hooks/meeting-details/useSummaryGeneration';
import { useModelConfiguration } from '@/hooks/meeting-details/useModelConfiguration';
import { useTemplates } from '@/hooks/meeting-details/useTemplates';
import { useCopyOperations } from '@/hooks/meeting-details/useCopyOperations';
import { useMeetingOperations } from '@/hooks/meeting-details/useMeetingOperations';

// Helper function to convert summary to plain text for Jira task generation
function getSummaryAsText(summary: Summary | null): string {
  if (!summary) return '';
  
  const sections: string[] = [];
  
  // Handle both legacy and new summary formats
  for (const [key, section] of Object.entries(summary)) {
    if (key.startsWith('_')) continue; // Skip metadata fields
    
    if (typeof section === 'object' && section !== null) {
      // Check if it's a Section with title and blocks
      if ('title' in section && 'blocks' in section) {
        const sectionTitle = section.title || key;
        const blocks = section.blocks || [];
        if (blocks.length > 0) {
          sections.push(`## ${sectionTitle}`);
          for (const block of blocks) {
            if (typeof block === 'object' && 'content' in block) {
              sections.push(`- ${block.content}`);
            } else if (typeof block === 'string') {
              sections.push(`- ${block}`);
            }
          }
          sections.push('');
        }
      }
      // Handle array format (e.g., key_points: string[])
      else if (Array.isArray(section)) {
        if (section.length > 0) {
          sections.push(`## ${key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`);
          for (const item of section) {
            sections.push(`- ${item}`);
          }
          sections.push('');
        }
      }
    }
  }
  
  return sections.join('\n');
}

export default function PageContent({
  meeting,
  summaryData,
  shouldAutoGenerate = false,
  onAutoGenerateComplete,
  onMeetingUpdated
}: {
  meeting: any;
  summaryData: Summary | null;
  shouldAutoGenerate?: boolean;
  onAutoGenerateComplete?: () => void;
  onMeetingUpdated?: () => Promise<void>;
}) {
  console.log('📄 PAGE CONTENT: Initializing with data:', {
    meetingId: meeting.id,
    summaryDataKeys: summaryData ? Object.keys(summaryData) : null,
    transcriptsCount: meeting.transcripts?.length
  });

  // State
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [isRecording] = useState(false);
  const [summaryResponse] = useState<SummaryResponse | null>(null);
  const [activeTab, setActiveTab] = useState<'summary' | 'jira'>('summary');

  // Sidebar context
  const { serverAddress } = useSidebar();

  // Custom hooks
  const meetingData = useMeetingData({ meeting, summaryData, onMeetingUpdated });
  const modelConfig = useModelConfiguration({ serverAddress });
  const templates = useTemplates();

  const summaryGeneration = useSummaryGeneration({
    meeting,
    transcripts: meetingData.transcripts,
    modelConfig: modelConfig.modelConfig,
    isModelConfigLoading: modelConfig.isLoading,
    selectedTemplate: templates.selectedTemplate,
    onMeetingUpdated,
    updateMeetingTitle: meetingData.updateMeetingTitle,
    setAiSummary: meetingData.setAiSummary,
  });

  const copyOperations = useCopyOperations({
    meeting,
    transcripts: meetingData.transcripts,
    meetingTitle: meetingData.meetingTitle,
    aiSummary: meetingData.aiSummary,
    blockNoteSummaryRef: meetingData.blockNoteSummaryRef,
  });

  const meetingOperations = useMeetingOperations({
    meeting,
  });

  // Track page view
  useEffect(() => {
    Analytics.trackPageView('meeting_details');
  }, []);

  // Auto-generate summary when flag is set
  useEffect(() => {
    const autoGenerate = async () => {
      if (shouldAutoGenerate && meetingData.transcripts.length > 0) {
        console.log(`🤖 Auto-generating summary with ${modelConfig.modelConfig.provider}/${modelConfig.modelConfig.model}...`);
        await summaryGeneration.handleGenerateSummary('');

        // Notify parent that auto-generation is complete
        if (onAutoGenerateComplete) {
          onAutoGenerateComplete();
        }
      }
    };

    autoGenerate();
  }, [shouldAutoGenerate]); // Only trigger when flag changes

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col h-screen bg-gray-50"
    >
      <div className="flex flex-1 overflow-hidden">


        <TranscriptPanel
          transcripts={meetingData.transcripts}
          customPrompt={customPrompt}
          onPromptChange={setCustomPrompt}
          onCopyTranscript={copyOperations.handleCopyTranscript}
          onOpenMeetingFolder={meetingOperations.handleOpenMeetingFolder}
          isRecording={isRecording}
        />

        <div className="flex-1 min-w-0 flex flex-col bg-white overflow-hidden border-l border-gray-200">
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setActiveTab('summary')}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors border-b-2 ${activeTab === 'summary'
                ? 'border-blue-600 text-blue-600 bg-blue-50'
                : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
            >
              <SparkleIcon className="w-4 h-4" />
              Summary
            </button>
            <button
              onClick={() => setActiveTab('jira')}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors border-b-2 ${activeTab === 'jira'
                ? 'border-blue-600 text-blue-600 bg-blue-50'
                : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
            >
              <Link className="w-4 h-4" />
              Jira Tasks
            </button>
          </div>

          <div className="flex-1 overflow-hidden relative">
            <div className={`absolute inset-0 ${activeTab === 'summary' ? 'block' : 'hidden'}`}>
              <SummaryPanel
                meeting={meeting}
                meetingTitle={meetingData.meetingTitle}
                onTitleChange={meetingData.handleTitleChange}
                isEditingTitle={meetingData.isEditingTitle}
                onStartEditTitle={() => meetingData.setIsEditingTitle(true)}
                onFinishEditTitle={() => meetingData.setIsEditingTitle(false)}
                isTitleDirty={meetingData.isTitleDirty}
                summaryRef={meetingData.blockNoteSummaryRef}
                isSaving={meetingData.isSaving}
                onSaveAll={meetingData.saveAllChanges}
                onCopySummary={copyOperations.handleCopySummary}
                onOpenFolder={meetingOperations.handleOpenMeetingFolder}
                aiSummary={meetingData.aiSummary}
                summaryStatus={summaryGeneration.summaryStatus}
                transcripts={meetingData.transcripts}
                modelConfig={modelConfig.modelConfig}
                setModelConfig={modelConfig.setModelConfig}
                onSaveModelConfig={modelConfig.handleSaveModelConfig}
                onGenerateSummary={summaryGeneration.handleGenerateSummary}
                customPrompt={customPrompt}
                summaryResponse={summaryResponse}
                onSaveSummary={meetingData.handleSaveSummary}
                onSummaryChange={meetingData.handleSummaryChange}
                onDirtyChange={meetingData.setIsSummaryDirty}
                summaryError={summaryGeneration.summaryError}
                onRegenerateSummary={summaryGeneration.handleRegenerateSummary}
                getSummaryStatusMessage={summaryGeneration.getSummaryStatusMessage}
                availableTemplates={templates.availableTemplates}
                selectedTemplate={templates.selectedTemplate}
                onTemplateSelect={templates.handleTemplateSelection}
                isModelConfigLoading={modelConfig.isLoading}
              />
            </div>

            <div className={`absolute inset-0 ${activeTab === 'jira' ? 'block' : 'hidden'}`}>
              <JiraPanel
                meetingId={meeting.id}
                hasTranscript={meetingData.transcripts.length > 0}
                transcriptText={meetingData.transcripts.map(t => t.text).join('\n')}
                summaryText={getSummaryAsText(meetingData.aiSummary)}
              />
            </div>
          </div>
        </div>

      </div>
    </motion.div>
  );
}
