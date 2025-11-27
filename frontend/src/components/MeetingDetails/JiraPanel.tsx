import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { 
    Loader2, Plus, RefreshCw, CheckCircle, AlertCircle, 
    Search, MessageSquare, ArrowRightCircle, Edit2, X,
    ExternalLink, Eye, Save, Send, HelpCircle, Wifi, WifiOff
} from 'lucide-react';
import { useExtensionConnection } from '@/hooks/useExtensionConnection';

interface JiraTask {
    summary: string;
    description: string;
    priority: string;
    type: string;
    assignee: string;
    // Enhanced fields for context-aware generation
    assignee_account_id?: string | null;
    labels?: string[] | null;
    related_issues?: string[] | null;
}

interface JiraProject {
    key: string;
    name: string;
    id: string;
}

interface JiraIssueType {
    name: string;
    id: string;
    iconUrl?: string;
}

interface JiraIssue {
    key: string;
    id: string;
    fields: {
        summary: string;
        description?: string;
        status: {
            name: string;
            statusCategory?: {
                colorName: string;
            };
        };
        priority?: {
            name: string;
            iconUrl?: string;
        };
        assignee?: {
            displayName: string;
            accountId: string;
        };
        issuetype?: {
            name: string;
            iconUrl?: string;
        };
    };
}

interface JiraTransition {
    id: string;
    name: string;
    to: {
        name: string;
    };
}

interface JiraPanelProps {
    meetingId: string;
    hasTranscript: boolean;
    transcriptText: string;
    summaryText?: string;  // Optional meeting summary for better task generation
}

type TabType = 'generate' | 'search' | 'questions';

export function JiraPanel({ meetingId, hasTranscript, transcriptText, summaryText }: JiraPanelProps) {
    // Tab state
    const [activeTab, setActiveTab] = useState<TabType>('generate');
    
    // Extension connection hook
    const { isConnected, status: extensionStatus, sendToChat, sendQuestions } = useExtensionConnection();
    
    // Common state
    const [loadingConfig, setLoadingConfig] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [projects, setProjects] = useState<JiraProject[]>([]);
    const [loadingProjects, setLoadingProjects] = useState(false);
    const [issueTypes, setIssueTypes] = useState<JiraIssueType[]>([]);
    const [loadingIssueTypes, setLoadingIssueTypes] = useState(false);
    const [selectedProject, setSelectedProject] = useState<string>('');
    const [config, setConfig] = useState<any>(null);

    // Generate tab state
    const [tasks, setTasks] = useState<JiraTask[]>([]);
    const [analyzing, setAnalyzing] = useState(false);
    const [creatingTaskIndex, setCreatingTaskIndex] = useState<number | null>(null);
    const [creationStatus, setCreationStatus] = useState<{ [key: number]: { type: 'success' | 'error', message: string } }>({});

    // Search tab state
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<JiraIssue[]>([]);
    const [searching, setSearching] = useState(false);
    const [searchTotal, setSearchTotal] = useState(0);

    // Modal state
    const [commentModal, setCommentModal] = useState<{ issue: JiraIssue; isOpen: boolean } | null>(null);
    const [commentText, setCommentText] = useState('');
    const [submittingComment, setSubmittingComment] = useState(false);
    
    const [transitionModal, setTransitionModal] = useState<{ issue: JiraIssue; isOpen: boolean } | null>(null);
    const [transitions, setTransitions] = useState<JiraTransition[]>([]);
    const [loadingTransitions, setLoadingTransitions] = useState(false);
    const [selectedTransition, setSelectedTransition] = useState<string>('');
    const [transitionComment, setTransitionComment] = useState('');
    const [submittingTransition, setSubmittingTransition] = useState(false);

    // Issue details and edit modals
    const [detailsModal, setDetailsModal] = useState<{ issue: JiraIssue | null; isOpen: boolean } | null>(null);
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [fullIssueDetails, setFullIssueDetails] = useState<any>(null);
    
    const [editModal, setEditModal] = useState<{ issue: JiraIssue; isOpen: boolean } | null>(null);
    
    // Questions tab state
    const [questions, setQuestions] = useState<string[]>([]);
    const [generatingQuestions, setGeneratingQuestions] = useState(false);
    const [selectedQuestions, setSelectedQuestions] = useState<Set<number>>(new Set());
    const [sendingQuestions, setSendingQuestions] = useState(false);
    const [questionsSent, setQuestionsSent] = useState(false);
    const [editSummary, setEditSummary] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [editPriority, setEditPriority] = useState('');
    const [editAssignee, setEditAssignee] = useState<string>('');
    const [editLabels, setEditLabels] = useState<string>('');
    const [editDueDate, setEditDueDate] = useState<string>('');
    const [editStartDate, setEditStartDate] = useState<string>('');
    const [submittingEdit, setSubmittingEdit] = useState(false);

    useEffect(() => {
        loadJiraConfig();
    }, []);

    useEffect(() => {
        if (config && config.url) {
            loadProjects();
        }
    }, [config]);

    useEffect(() => {
        if (selectedProject) {
            loadIssueTypes(selectedProject);
        }
    }, [selectedProject]);

    const loadJiraConfig = async () => {
        try {
            setLoadingConfig(true);
            setError(null);
            const conf = await invoke('api_get_jira_config') as any;
            setConfig(conf);
            if (conf?.default_project_key) {
                setSelectedProject(conf.default_project_key);
            }
        } catch (error: any) {
            console.error('Failed to load Jira config:', error);
            const errorMessage = error.message || error.toString() || 'Unknown error';
            if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
                setError('Request timed out. Please check if the backend server is running on http://localhost:5167');
            } else {
                setError(`Failed to load Jira configuration: ${errorMessage}`);
            }
        } finally {
            setLoadingConfig(false);
        }
    };

    const loadProjects = async () => {
        try {
            setLoadingProjects(true);
            setError(null);
            const projs = await invoke('api_get_jira_projects') as JiraProject[];
            setProjects(projs);
        } catch (error: any) {
            console.error('Failed to load projects:', error);
            const errorMessage = error.message || error.toString() || 'Unknown error';
            setError(`Failed to load Jira projects: ${errorMessage}`);
        } finally {
            setLoadingProjects(false);
        }
    };

    const loadIssueTypes = async (projectKey: string) => {
        try {
            setLoadingIssueTypes(true);
            setError(null);
            const types = await invoke('api_get_jira_issue_types', { projectKey }) as JiraIssueType[];
            setIssueTypes(types);
        } catch (error: any) {
            console.error('Failed to load issue types:', error);
            setError(`Failed to load issue types: ${error.message || error}`);
        } finally {
            setLoadingIssueTypes(false);
        }
    };

    // Check if we have a summary available
    const hasSummary = summaryText && summaryText.trim().length > 0;

    // === Generate Tab Functions ===
    const analyzeTasks = async (e?: React.MouseEvent) => {
        e?.preventDefault();
        e?.stopPropagation();
        try {
            // Prefer summary over raw transcript for better task generation
            const textToAnalyze = hasSummary ? summaryText : transcriptText;
            
            if (!hasSummary && (!hasTranscript || !transcriptText || transcriptText.trim() === '')) {
                setError('No transcript or summary available for this meeting. Generate a summary first for better results.');
                return;
            }

            if (!selectedProject) {
                setError('Please select a project before generating tasks. Project context improves task accuracy.');
                return;
            }

            setAnalyzing(true);
            setError(null);

            let modelProvider = 'openai';
            let modelName = 'gpt-4o';

            try {
                const modelConfig = await invoke('api_get_model_config') as any;
                if (modelConfig && modelConfig.provider && modelConfig.model) {
                    modelProvider = modelConfig.provider;
                    modelName = modelConfig.model;
                }
            } catch (error) {
                console.warn('Failed to load model config, using OpenAI GPT-4o as fallback');
            }

            const response = await invoke('api_analyze_jira_tasks', {
                request: {
                    meeting_id: meetingId,
                    model: modelProvider,
                    model_name: modelName,
                    text: textToAnalyze,
                    project_key: selectedProject,
                }
            }) as { tasks: JiraTask[] };

            setTasks(response.tasks);
            if (response.tasks.length === 0) {
                setError('No actionable tasks found. Try generating a detailed summary first.');
            }
        } catch (error: any) {
            console.error('Failed to analyze tasks:', error);
            const raw = typeof error === 'string' ? error : (error?.message || JSON.stringify(error));
            setError(`Failed to analyze: ${raw || 'Unknown error'}. Please try again.`);
        } finally {
            setAnalyzing(false);
        }
    };

    const pickIssueType = (taskType?: string): string | undefined => {
        if (!issueTypes.length) return undefined;
        const normalize = (value?: string) => value?.trim().toLowerCase();
        const preferred = issueTypes.find((type) => normalize(type.name) === normalize(taskType));
        if (preferred) return preferred.name;
        if (config?.default_issue_type) {
            const configured = issueTypes.find((type) => normalize(type.name) === normalize(config.default_issue_type));
            if (configured) return configured.name;
        }
        return issueTypes[0]?.name;
    };

    const createTask = async (task: JiraTask, index: number, e?: React.MouseEvent) => {
        e?.preventDefault();
        e?.stopPropagation();
        
        if (!selectedProject) {
            setCreationStatus({ ...creationStatus, [index]: { type: 'error', message: 'Please select a project first' } });
            return;
        }

        if (!issueTypes.length) {
            setCreationStatus({ ...creationStatus, [index]: { type: 'error', message: 'No issue types available' } });
            return;
        }

        const issueTypeToUse = pickIssueType(task.type);
        if (!issueTypeToUse) {
            setCreationStatus({ ...creationStatus, [index]: { type: 'error', message: 'Unable to determine issue type' } });
            return;
        }

        try {
            setCreatingTaskIndex(index);
            const result = await invoke('api_create_jira_task', {
                task: {
                    project_key: selectedProject,
                    summary: task.summary,
                    description: task.description,
                    issue_type: issueTypeToUse,
                    // Include suggested labels and assignee from LLM
                    labels: task.labels || undefined,
                    assignee: task.assignee_account_id || undefined,
                }
            }) as any;

            setCreationStatus({ ...creationStatus, [index]: { type: 'success', message: `Created: ${result.key}` } });
        } catch (error: any) {
            console.error('Failed to create task:', error);
            setCreationStatus({ ...creationStatus, [index]: { type: 'error', message: error.message || 'Failed to create task' } });
        } finally {
            setCreatingTaskIndex(null);
        }
    };

    // === Search Tab Functions ===
    const searchIssues = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!searchQuery.trim()) return;

        try {
            setSearching(true);
            setError(null);
            
            // Build JQL query - if it looks like a key (e.g., PROJ-123), search by key, otherwise text search
            let jql = searchQuery.trim();
            const keyPattern = /^[A-Z]+-\d+$/i;
            if (!jql.includes('=') && !jql.includes('~')) {
                if (keyPattern.test(jql)) {
                    jql = `key = "${jql.toUpperCase()}"`;
                } else {
                    // Text search in summary and description
                    jql = `text ~ "${jql}" ORDER BY updated DESC`;
                }
            }
            
            // Add project filter if selected
            if (selectedProject && !jql.toLowerCase().includes('project')) {
                jql = `project = ${selectedProject} AND (${jql})`;
            }

            const result = await invoke('api_search_jira_issues', { 
                jql,
                maxResults: 25 
            }) as { issues: JiraIssue[]; total: number };

            setSearchResults(result.issues || []);
            setSearchTotal(result.total || 0);
        } catch (error: any) {
            console.error('Failed to search issues:', error);
            setError(`Search failed: ${error.message || error}`);
        } finally {
            setSearching(false);
        }
    };

    // === Comment Modal Functions ===
    const openCommentModal = (issue: JiraIssue) => {
        setCommentModal({ issue, isOpen: true });
        setCommentText('');
    };

    const closeCommentModal = () => {
        setCommentModal(null);
        setCommentText('');
    };

    const submitComment = async () => {
        if (!commentModal || !commentText.trim()) return;

        try {
            setSubmittingComment(true);
            await invoke('api_add_jira_comment', {
                issueKey: commentModal.issue.key,
                comment: { body: commentText.trim() }
            });
            closeCommentModal();
            // Show success message briefly
            setError(null);
        } catch (error: any) {
            console.error('Failed to add comment:', error);
            setError(`Failed to add comment: ${error.message || error}`);
        } finally {
            setSubmittingComment(false);
        }
    };

    // === Transition Modal Functions ===
    const openTransitionModal = async (issue: JiraIssue) => {
        setTransitionModal({ issue, isOpen: true });
        setSelectedTransition('');
        setTransitionComment('');
        setLoadingTransitions(true);

        try {
            const result = await invoke('api_get_jira_transitions', { issueKey: issue.key }) as JiraTransition[];
            setTransitions(result);
        } catch (error: any) {
            console.error('Failed to load transitions:', error);
            setError(`Failed to load transitions: ${error.message || error}`);
        } finally {
            setLoadingTransitions(false);
        }
    };

    const closeTransitionModal = () => {
        setTransitionModal(null);
        setTransitions([]);
        setSelectedTransition('');
        setTransitionComment('');
    };

    const submitTransition = async () => {
        if (!transitionModal || !selectedTransition) return;

        try {
            setSubmittingTransition(true);
            await invoke('api_transition_jira_issue', {
                issueKey: transitionModal.issue.key,
                transition: {
                    transition_id: selectedTransition,
                    comment: transitionComment.trim() || null
                }
            });
            closeTransitionModal();
            // Refresh search results to show updated status
            if (searchQuery) {
                searchIssues();
            }
        } catch (error: any) {
            console.error('Failed to transition issue:', error);
            setError(`Failed to transition issue: ${error.message || error}`);
        } finally {
            setSubmittingTransition(false);
        }
    };

    // === Issue Details Modal Functions ===
    const openDetailsModal = async (issue: JiraIssue) => {
        setDetailsModal({ issue, isOpen: true });
        setLoadingDetails(true);
        setFullIssueDetails(null);

        try {
            const details = await invoke('api_get_jira_issue', { issueKey: issue.key }) as any;
            setFullIssueDetails(details);
        } catch (error: any) {
            console.error('Failed to load issue details:', error);
            setError(`Failed to load issue details: ${error.message || error}`);
        } finally {
            setLoadingDetails(false);
        }
    };

    const closeDetailsModal = () => {
        setDetailsModal(null);
        setFullIssueDetails(null);
    };

    // === Edit Issue Modal Functions ===
    const openEditModal = (issue: JiraIssue) => {
        setEditModal({ issue, isOpen: true });
        setEditSummary(issue.fields.summary);
        setEditDescription(issue.fields.description || '');
        setEditPriority(issue.fields.priority?.name || '');
        setEditAssignee(issue.fields.assignee?.accountId || '');
        // Extract labels from issue if available
        const labels = (issue.fields as any).labels || [];
        setEditLabels(labels.join(', '));
        // Extract dates if available
        setEditDueDate((issue.fields as any).duedate || '');
        setEditStartDate((issue.fields as any).customfield_10020 || '');
    };

    const closeEditModal = () => {
        setEditModal(null);
        setEditSummary('');
        setEditDescription('');
        setEditPriority('');
        setEditAssignee('');
        setEditLabels('');
        setEditDueDate('');
        setEditStartDate('');
    };

    const submitEdit = async () => {
        if (!editModal) return;

        try {
            setSubmittingEdit(true);
            const updateFields: any = {};
            const originalIssue = editModal.issue.fields;
            
            if (editSummary !== originalIssue.summary) {
                updateFields.summary = editSummary;
            }
            if (editDescription !== (originalIssue.description || '')) {
                updateFields.description = editDescription;
            }
            if (editPriority && editPriority !== originalIssue.priority?.name) {
                updateFields.priority = editPriority;
            }
            
            // Handle assignee
            const originalAssignee = originalIssue.assignee?.accountId || '';
            if (editAssignee !== originalAssignee) {
                updateFields.assignee = editAssignee || "-1";  // "-1" means unassign
            }
            
            // Handle labels
            const originalLabels = ((originalIssue as any).labels || []).join(', ');
            if (editLabels.trim() !== originalLabels) {
                const labelsArray = editLabels.split(',').map(l => l.trim()).filter(l => l.length > 0);
                updateFields.labels = labelsArray.length > 0 ? labelsArray : null;
            }
            
            // Handle due date
            const originalDueDate = (originalIssue as any).duedate || '';
            if (editDueDate !== originalDueDate) {
                updateFields.duedate = editDueDate || null;
            }
            
            // Handle start date
            const originalStartDate = (originalIssue as any).customfield_10020 || '';
            if (editStartDate !== originalStartDate) {
                updateFields.customfield_10020 = editStartDate || null;
            }

            if (Object.keys(updateFields).length === 0) {
                setError('No changes to save');
                return;
            }

            await invoke('api_update_jira_issue', {
                issueKey: editModal.issue.key,
                update: updateFields
            });

            closeEditModal();
            // Refresh search results to show updated data
            if (searchQuery) {
                searchIssues();
            }
        } catch (error: any) {
            console.error('Failed to update issue:', error);
            setError(`Failed to update issue: ${error.message || error}`);
        } finally {
            setSubmittingEdit(false);
        }
    };

    // === Questions Tab Functions ===
    const generateClarifyingQuestions = async () => {
        try {
            const textToAnalyze = summaryText && summaryText.trim() ? summaryText : transcriptText;
            
            if (!textToAnalyze || textToAnalyze.trim() === '') {
                setError('No transcript or summary available to generate questions from.');
                return;
            }

            setGeneratingQuestions(true);
            setError(null);
            setQuestionsSent(false);

            let modelProvider = 'openai';
            let modelName = 'gpt-4o';

            try {
                const modelConfig = await invoke('api_get_model_config') as any;
                if (modelConfig && modelConfig.provider && modelConfig.model) {
                    modelProvider = modelConfig.provider;
                    modelName = modelConfig.model;
                }
            } catch (error) {
                console.warn('Failed to load model config, using OpenAI GPT-4o as fallback');
            }

            const response = await invoke('api_generate_clarifying_questions', {
                request: {
                    meeting_id: meetingId,
                    model: modelProvider,
                    model_name: modelName,
                    text: textToAnalyze,
                    project_key: selectedProject || null,
                }
            }) as { questions: string[]; count: number };

            setQuestions(response.questions);
            // Select all questions by default
            setSelectedQuestions(new Set(response.questions.map((_, i) => i)));
            
            if (response.questions.length === 0) {
                setError('No clarifying questions found. The transcript may already contain all necessary details.');
            }
        } catch (error: any) {
            console.error('Failed to generate questions:', error);
            setError(`Failed to generate questions: ${error.message || error}`);
        } finally {
            setGeneratingQuestions(false);
        }
    };

    const toggleQuestionSelection = (index: number) => {
        setSelectedQuestions(prev => {
            const newSet = new Set(prev);
            if (newSet.has(index)) {
                newSet.delete(index);
            } else {
                newSet.add(index);
            }
            return newSet;
        });
    };

    const selectAllQuestions = () => {
        setSelectedQuestions(new Set(questions.map((_, i) => i)));
    };

    const deselectAllQuestions = () => {
        setSelectedQuestions(new Set());
    };

    const sendSelectedQuestions = async () => {
        const selectedQs = questions.filter((_, i) => selectedQuestions.has(i));
        
        if (selectedQs.length === 0) {
            setError('Please select at least one question to send.');
            return;
        }

        if (!isConnected) {
            setError('Browser extension is not connected. Please make sure the extension is installed and the backend is running.');
            return;
        }

        try {
            setSendingQuestions(true);
            setError(null);

            const result = await sendQuestions(selectedQs);
            
            if (result.success) {
                setQuestionsSent(true);
                setError(null);
            } else {
                setError(`Failed to send some questions: ${result.sent}/${result.total} sent successfully.`);
            }
        } catch (error: any) {
            console.error('Failed to send questions:', error);
            setError(`Failed to send questions to chat: ${error.message || error}`);
        } finally {
            setSendingQuestions(false);
        }
    };

    // === Status Badge Helper ===
    const getStatusColor = (status: JiraIssue['fields']['status']) => {
        const category = status.statusCategory?.colorName?.toLowerCase();
        switch (category) {
            case 'green': return 'bg-green-100 text-green-800';
            case 'yellow': return 'bg-yellow-100 text-yellow-800';
            case 'blue-gray': return 'bg-gray-100 text-gray-800';
            default: return 'bg-blue-100 text-blue-800';
        }
    };

    // === Render Loading State ===
    if (loadingConfig) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center text-gray-500">
                <Loader2 className="w-12 h-12 mb-4 text-gray-400 animate-spin" />
                <h3 className="text-lg font-medium text-gray-900">Loading Jira Configuration</h3>
                <p className="mt-2 text-sm">Please wait...</p>
            </div>
        );
    }

    // === Render Not Configured State ===
    if (!config?.url) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center text-gray-500">
                <AlertCircle className="w-12 h-12 mb-4 text-gray-400" />
                <h3 className="text-lg font-medium text-gray-900">Jira Not Configured</h3>
                <p className="mt-2 text-sm">Please configure Jira settings to use this feature.</p>
                <a href="/settings" className="mt-4 text-blue-600 hover:underline">Go to Settings</a>
            </div>
        );
    }

    // === Main Render ===
    return (
        <div className="flex flex-col h-full bg-gray-50">
            {/* Header with Project Selector and Tabs */}
            <div className="p-4 border-b border-gray-200 bg-white">
                <div className="flex items-center justify-between mb-4">
                    {loadingProjects ? (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Loading projects...</span>
                        </div>
                    ) : (
                        <select
                            value={selectedProject}
                            onChange={(e) => setSelectedProject(e.target.value)}
                            disabled={loadingProjects}
                            className="block w-48 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md disabled:opacity-50"
                        >
                            <option value="">Select Project</option>
                            {projects.map((p) => (
                                <option key={p.id} value={p.key}>{p.name} ({p.key})</option>
                            ))}
                        </select>
                    )}
                    {loadingIssueTypes && selectedProject && (
                        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                    )}
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-200">
                    <button
                        onClick={() => setActiveTab('generate')}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === 'generate'
                                ? 'border-blue-500 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                        Generate New
                    </button>
                    <button
                        onClick={() => setActiveTab('search')}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === 'search'
                                ? 'border-blue-500 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                        Search Existing
                    </button>
                    <button
                        onClick={() => setActiveTab('questions')}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                            activeTab === 'questions'
                                ? 'border-purple-500 text-purple-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                        <HelpCircle className="w-4 h-4" />
                        Ask Questions
                    </button>
                    
                    {/* Extension Status Indicator */}
                    <div className="ml-auto flex items-center px-2">
                        {isConnected ? (
                            <span className="flex items-center text-xs text-green-600" title="Browser extension connected">
                                <Wifi className="w-3.5 h-3.5 mr-1" />
                                Connected
                            </span>
                        ) : (
                            <span className="flex items-center text-xs text-gray-400" title="Browser extension not connected">
                                <WifiOff className="w-3.5 h-3.5 mr-1" />
                                Disconnected
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Error Display */}
            {error && (
                <div className="m-4 p-4 bg-red-50 border border-red-200 rounded-md flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                        <p className="text-sm font-medium text-red-800">Error</p>
                        <p className="text-sm text-red-700 mt-1">{error}</p>
                    </div>
                    <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800 text-xl leading-none">
                        ×
                    </button>
                </div>
            )}

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto">
                {activeTab === 'generate' ? (
                    /* Generate Tab */
                    <div className="p-4">
                        <div className="mb-4 flex justify-between items-center">
                            {!selectedProject && (
                                <p className="text-sm text-amber-600">
                                    ⚠️ Select a project above for better task generation
                                </p>
                            )}
                            <div className="flex-1" />
                            <button
                                onClick={analyzeTasks}
                                disabled={analyzing || !hasTranscript || !selectedProject}
                                title={!selectedProject ? 'Please select a project first' : undefined}
                                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {analyzing ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Analyzing...
                                    </>
                                ) : (
                                    <>
                                        <RefreshCw className="w-4 h-4 mr-2" />
                                        Generate Tasks
                                    </>
                                )}
                            </button>
                        </div>

                        {/* Source indicator */}
                        {hasSummary && (
                            <div className="mb-3 p-2 bg-green-50 border border-green-200 rounded-md">
                                <p className="text-sm text-green-700">
                                    ✓ Using meeting summary for better task generation
                                </p>
                            </div>
                        )}
                        {!hasSummary && hasTranscript && (
                            <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded-md">
                                <p className="text-sm text-amber-700">
                                    ⚠️ Using raw transcript. Generate a summary first for better results.
                                </p>
                            </div>
                        )}

                        <div className="space-y-4">
                            {tasks.length === 0 && !analyzing ? (
                                <div className="text-center py-12 text-gray-500">
                                    <p>No tasks generated yet.</p>
                                    <p className="text-sm mt-2">
                                        {hasSummary 
                                            ? 'Click "Generate Tasks" to analyze the meeting summary.'
                                            : 'Generate a meeting summary first, then create Jira tasks.'}
                                    </p>
                                </div>
                            ) : (
                                tasks.map((task, index) => (
                                    <div key={index} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                                        <div className="flex justify-between items-start gap-4">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                                                        task.priority === 'High' ? 'bg-red-100 text-red-800' :
                                                        task.priority === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
                                                        'bg-green-100 text-green-800'
                                                    }`}>
                                                        {task.priority}
                                                    </span>
                                                    <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-800 rounded-full">
                                                        {task.type}
                                                    </span>
                                                </div>
                                                <h4 className="text-base font-medium text-gray-900 mb-1">{task.summary}</h4>
                                                <p className="text-sm text-gray-600 mb-2 whitespace-pre-wrap">{task.description}</p>
                                                
                                                {/* Labels */}
                                                {task.labels && task.labels.length > 0 && (
                                                    <div className="flex flex-wrap gap-1 mb-2">
                                                        {task.labels.map((label, labelIndex) => (
                                                            <span 
                                                                key={labelIndex}
                                                                className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-800 rounded-full"
                                                            >
                                                                {label}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                                
                                                {/* Related Issues */}
                                                {task.related_issues && task.related_issues.length > 0 && (
                                                    <div className="flex flex-wrap gap-1 mb-2">
                                                        <span className="text-xs text-gray-500">Related:</span>
                                                        {task.related_issues.map((issueKey, issueIndex) => (
                                                            <a 
                                                                key={issueIndex}
                                                                href={config?.url ? `${config.url}/browse/${issueKey}` : '#'}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="px-1.5 py-0.5 text-xs font-mono font-medium bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                                                            >
                                                                {issueKey}
                                                            </a>
                                                        ))}
                                                    </div>
                                                )}
                                                
                                                <div className="text-xs text-gray-500">
                                                    Suggested Assignee: {task.assignee}
                                                    {task.assignee_account_id && (
                                                        <span className="ml-1 text-green-600" title="Matched to team member">✓</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end gap-2">
                                                <button
                                                    onClick={(e) => createTask(task, index, e)}
                                                    disabled={creatingTaskIndex === index || !!creationStatus[index]?.type}
                                                    className={`inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded shadow-sm text-white ${
                                                        creationStatus[index]?.type === 'success' ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-700'
                                                    } focus:outline-none disabled:opacity-50`}
                                                >
                                                    {creatingTaskIndex === index ? (
                                                        <Loader2 className="w-3 h-3 animate-spin" />
                                                    ) : creationStatus[index]?.type === 'success' ? (
                                                        <>
                                                            <CheckCircle className="w-3 h-3 mr-1" />
                                                            Created
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Plus className="w-3 h-3 mr-1" />
                                                            Create
                                                        </>
                                                    )}
                                                </button>
                                                {creationStatus[index] && (
                                                    <span className={`text-xs ${creationStatus[index].type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                                                        {creationStatus[index].message}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                ) : activeTab === 'search' ? (
                    /* Search Tab */
                    <div className="p-4">
                        {/* Search Input */}
                        <form onSubmit={searchIssues} className="mb-4">
                            <div className="flex gap-2">
                                <div className="flex-1 relative">
                                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Search issues (e.g., PROJ-123 or keywords)..."
                                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={searching || !searchQuery.trim()}
                                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                                >
                                    {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
                                </button>
                            </div>
                        </form>

                        {/* Search Results */}
                        <div className="space-y-3">
                            {searchTotal > 0 && (
                                <p className="text-sm text-gray-500 mb-2">
                                    Found {searchTotal} issue{searchTotal !== 1 ? 's' : ''}
                                    {searchTotal > searchResults.length && ` (showing ${searchResults.length})`}
                                </p>
                            )}

                            {searchResults.length === 0 && !searching && searchQuery && (
                                <div className="text-center py-8 text-gray-500">
                                    <p>No issues found. Try a different search term.</p>
                                </div>
                            )}

                            {searchResults.map((issue) => (
                                <div key={issue.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                                    <div className="flex justify-between items-start gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                <span className="font-mono text-sm text-blue-600 font-medium">
                                                    {issue.key}
                                                </span>
                                                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(issue.fields.status)}`}>
                                                    {issue.fields.status.name}
                                                </span>
                                                {issue.fields.priority && (
                                                    <span className="text-xs text-gray-500">
                                                        {issue.fields.priority.name}
                                                    </span>
                                                )}
                                            </div>
                                            <h4 className="text-base font-medium text-gray-900 mb-1 truncate">
                                                {issue.fields.summary}
                                            </h4>
                                            {issue.fields.assignee && (
                                                <p className="text-xs text-gray-500">
                                                    Assignee: {issue.fields.assignee.displayName}
                                                </p>
                                            )}
                                        </div>
                                        
                                        {/* Action Buttons */}
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                            <button
                                                onClick={() => openDetailsModal(issue)}
                                                className="p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-md transition-colors"
                                                title="View Details"
                                            >
                                                <Eye className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => openEditModal(issue)}
                                                className="p-2 text-gray-500 hover:text-orange-600 hover:bg-orange-50 rounded-md transition-colors"
                                                title="Edit Issue"
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => openCommentModal(issue)}
                                                className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                                                title="Add Comment"
                                            >
                                                <MessageSquare className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => openTransitionModal(issue)}
                                                className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-md transition-colors"
                                                title="Change Status"
                                            >
                                                <ArrowRightCircle className="w-4 h-4" />
                                            </button>
                                            <a
                                                href={`${config.url}/browse/${issue.key}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                                                title="Open in Jira"
                                            >
                                                <ExternalLink className="w-4 h-4" />
                                            </a>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    /* Questions Tab */
                    <div className="p-4">
                        {/* Info Banner */}
                        <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-md">
                            <div className="flex items-start gap-2">
                                <HelpCircle className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
                                <div>
                                    <p className="text-sm text-purple-800 font-medium">Ask Clarifying Questions</p>
                                    <p className="text-xs text-purple-700 mt-1">
                                        Generate questions to ask meeting participants about missing task details 
                                        (assignees, deadlines, priorities). Questions will be posted directly to 
                                        the meeting chat.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Connection Warning */}
                        {!isConnected && (
                            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-md">
                                <div className="flex items-start gap-2">
                                    <WifiOff className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                                    <div>
                                        <p className="text-sm text-amber-800 font-medium">Browser Extension Not Connected</p>
                                        <p className="text-xs text-amber-700 mt-1">
                                            To send questions to the meeting chat, ensure the browser extension is 
                                            installed and you have an active meeting tab open.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Generate Button */}
                        <div className="mb-4 flex justify-between items-center">
                            <div className="text-sm text-gray-600">
                                {questions.length > 0 && (
                                    <span>{selectedQuestions.size} of {questions.length} selected</span>
                                )}
                            </div>
                            <button
                                onClick={generateClarifyingQuestions}
                                disabled={generatingQuestions || (!hasTranscript && !summaryText)}
                                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {generatingQuestions ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Generating...
                                    </>
                                ) : (
                                    <>
                                        <RefreshCw className="w-4 h-4 mr-2" />
                                        Generate Questions
                                    </>
                                )}
                            </button>
                        </div>

                        {/* Questions List */}
                        <div className="space-y-3">
                            {questions.length === 0 && !generatingQuestions ? (
                                <div className="text-center py-12 text-gray-500">
                                    <HelpCircle className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                                    <p>No questions generated yet.</p>
                                    <p className="text-sm mt-2">
                                        Click "Generate Questions" to analyze the transcript for items 
                                        that need clarification.
                                    </p>
                                </div>
                            ) : (
                                <>
                                    {/* Select All / Deselect All */}
                                    {questions.length > 0 && (
                                        <div className="flex gap-2 mb-2">
                                            <button
                                                onClick={selectAllQuestions}
                                                className="text-xs text-purple-600 hover:text-purple-800"
                                            >
                                                Select All
                                            </button>
                                            <span className="text-gray-300">|</span>
                                            <button
                                                onClick={deselectAllQuestions}
                                                className="text-xs text-purple-600 hover:text-purple-800"
                                            >
                                                Deselect All
                                            </button>
                                        </div>
                                    )}

                                    {questions.map((question, index) => (
                                        <div 
                                            key={index} 
                                            className={`bg-white rounded-lg shadow-sm border p-4 cursor-pointer transition-colors ${
                                                selectedQuestions.has(index) 
                                                    ? 'border-purple-300 bg-purple-50' 
                                                    : 'border-gray-200 hover:border-purple-200'
                                            }`}
                                            onClick={() => toggleQuestionSelection(index)}
                                        >
                                            <div className="flex items-start gap-3">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedQuestions.has(index)}
                                                    onChange={() => toggleQuestionSelection(index)}
                                                    className="mt-1 h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                                <div className="flex-1">
                                                    <p className="text-sm text-gray-900">{question}</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}

                                    {/* Send Button */}
                                    {questions.length > 0 && (
                                        <div className="mt-6 flex justify-end">
                                            <button
                                                onClick={sendSelectedQuestions}
                                                disabled={sendingQuestions || selectedQuestions.size === 0 || !isConnected}
                                                className={`inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                                                    questionsSent 
                                                        ? 'bg-green-600 hover:bg-green-700 focus:ring-green-500' 
                                                        : 'bg-purple-600 hover:bg-purple-700 focus:ring-purple-500'
                                                }`}
                                            >
                                                {sendingQuestions ? (
                                                    <>
                                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                        Sending...
                                                    </>
                                                ) : questionsSent ? (
                                                    <>
                                                        <CheckCircle className="w-4 h-4 mr-2" />
                                                        Sent to Chat!
                                                    </>
                                                ) : (
                                                    <>
                                                        <Send className="w-4 h-4 mr-2" />
                                                        Send to Meeting Chat ({selectedQuestions.size})
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Comment Modal */}
            {commentModal?.isOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
                        <div className="flex items-center justify-between p-4 border-b">
                            <h3 className="text-lg font-medium text-gray-900">
                                Add Comment to {commentModal.issue.key}
                            </h3>
                            <button onClick={closeCommentModal} className="text-gray-400 hover:text-gray-500">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-4">
                            <p className="text-sm text-gray-600 mb-3">{commentModal.issue.fields.summary}</p>
                            <textarea
                                value={commentText}
                                onChange={(e) => setCommentText(e.target.value)}
                                placeholder="Enter your comment..."
                                rows={4}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                        <div className="flex justify-end gap-3 p-4 border-t bg-gray-50 rounded-b-lg">
                            <button
                                onClick={closeCommentModal}
                                className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={submitComment}
                                disabled={submittingComment || !commentText.trim()}
                                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
                            >
                                {submittingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add Comment'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Transition Modal */}
            {transitionModal?.isOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
                        <div className="flex items-center justify-between p-4 border-b">
                            <h3 className="text-lg font-medium text-gray-900">
                                Transition {transitionModal.issue.key}
                            </h3>
                            <button onClick={closeTransitionModal} className="text-gray-400 hover:text-gray-500">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-4">
                            <p className="text-sm text-gray-600 mb-1">{transitionModal.issue.fields.summary}</p>
                            <p className="text-xs text-gray-500 mb-4">
                                Current status: <span className="font-medium">{transitionModal.issue.fields.status.name}</span>
                            </p>
                            
                            {loadingTransitions ? (
                                <div className="flex items-center justify-center py-4">
                                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                                </div>
                            ) : transitions.length === 0 ? (
                                <p className="text-sm text-gray-500 text-center py-4">No transitions available for this issue.</p>
                            ) : (
                                <>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Move to:
                                    </label>
                                    <select
                                        value={selectedTransition}
                                        onChange={(e) => setSelectedTransition(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-4"
                                    >
                                        <option value="">Select a transition...</option>
                                        {transitions.map((t) => (
                                            <option key={t.id} value={t.id}>{t.name} → {typeof t.to === 'string' ? t.to : t.to.name}</option>
                                        ))}
                                    </select>
                                    
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Comment (optional):
                                    </label>
                                    <textarea
                                        value={transitionComment}
                                        onChange={(e) => setTransitionComment(e.target.value)}
                                        placeholder="Add a comment about this transition..."
                                        rows={3}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    />
                                </>
                            )}
                        </div>
                        <div className="flex justify-end gap-3 p-4 border-t bg-gray-50 rounded-b-lg">
                            <button
                                onClick={closeTransitionModal}
                                className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={submitTransition}
                                disabled={submittingTransition || !selectedTransition}
                                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50"
                            >
                                {submittingTransition ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Transition'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Issue Details Modal */}
            {detailsModal?.isOpen && detailsModal.issue && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
                        <div className="flex items-center justify-between p-4 border-b">
                            <h3 className="text-lg font-medium text-gray-900">
                                Issue Details: {detailsModal.issue.key}
                            </h3>
                            <button onClick={closeDetailsModal} className="text-gray-400 hover:text-gray-500">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            {loadingDetails ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                                </div>
                            ) : fullIssueDetails ? (
                                <div className="space-y-4">
                                    <div>
                                        <h4 className="text-sm font-medium text-gray-500 mb-1">Summary</h4>
                                        <p className="text-base text-gray-900">{fullIssueDetails.fields?.summary || 'N/A'}</p>
                                    </div>
                                    
                                    {fullIssueDetails.fields?.description && (
                                        <div>
                                            <h4 className="text-sm font-medium text-gray-500 mb-1">Description</h4>
                                            <div className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 p-3 rounded-md">
                                                {typeof fullIssueDetails.fields.description === 'string' 
                                                    ? fullIssueDetails.fields.description 
                                                    : 'Description available (formatted content)'}
                                            </div>
                                        </div>
                                    )}
                                    
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <h4 className="text-sm font-medium text-gray-500 mb-1">Status</h4>
                                            <p className="text-sm text-gray-900">{fullIssueDetails.fields?.status?.name || 'N/A'}</p>
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-medium text-gray-500 mb-1">Type</h4>
                                            <p className="text-sm text-gray-900">{fullIssueDetails.fields?.issuetype?.name || 'N/A'}</p>
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-medium text-gray-500 mb-1">Priority</h4>
                                            <p className="text-sm text-gray-900">{fullIssueDetails.fields?.priority?.name || 'N/A'}</p>
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-medium text-gray-500 mb-1">Assignee</h4>
                                            <p className="text-sm text-gray-900">{fullIssueDetails.fields?.assignee?.displayName || 'Unassigned'}</p>
                                        </div>
                                    </div>
                                    
                                    {fullIssueDetails.fields?.created && (
                                        <div>
                                            <h4 className="text-sm font-medium text-gray-500 mb-1">Created</h4>
                                            <p className="text-sm text-gray-900">
                                                {new Date(fullIssueDetails.fields.created).toLocaleString()}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <p className="text-sm text-gray-500 text-center py-4">Failed to load issue details.</p>
                            )}
                        </div>
                        <div className="flex justify-end gap-3 p-4 border-t bg-gray-50">
                            <button
                                onClick={closeDetailsModal}
                                className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-300"
                            >
                                Close
                            </button>
                            {detailsModal.issue && (
                                <a
                                    href={`${config.url}/browse/${detailsModal.issue.key}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 inline-flex items-center gap-2"
                                >
                                    <ExternalLink className="w-4 h-4" />
                                    Open in Jira
                                </a>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Issue Modal */}
            {editModal?.isOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
                        <div className="flex items-center justify-between p-4 border-b">
                            <h3 className="text-lg font-medium text-gray-900">
                                Edit Issue: {editModal.issue.key}
                            </h3>
                            <button onClick={closeEditModal} className="text-gray-400 hover:text-gray-500">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Summary *
                                </label>
                                <input
                                    type="text"
                                    value={editSummary}
                                    onChange={(e) => setEditSummary(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    required
                                />
                            </div>
                            
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Description
                                </label>
                                <textarea
                                    value={editDescription}
                                    onChange={(e) => setEditDescription(e.target.value)}
                                    rows={4}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Priority
                                    </label>
                                    <input
                                        type="text"
                                        value={editPriority}
                                        onChange={(e) => setEditPriority(e.target.value)}
                                        placeholder="e.g., High, Medium, Low"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    />
                                </div>
                                
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Assignee (Account ID)
                                    </label>
                                    <input
                                        type="text"
                                        value={editAssignee}
                                        onChange={(e) => setEditAssignee(e.target.value)}
                                        placeholder="Account ID or leave empty to unassign"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Leave empty to unassign</p>
                                </div>
                            </div>
                            
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Labels
                                </label>
                                <input
                                    type="text"
                                    value={editLabels}
                                    onChange={(e) => setEditLabels(e.target.value)}
                                    placeholder="Comma-separated labels (e.g., bug, frontend, urgent)"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                                <p className="text-xs text-gray-500 mt-1">Separate multiple labels with commas</p>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Due Date
                                    </label>
                                    <input
                                        type="date"
                                        value={editDueDate}
                                        onChange={(e) => setEditDueDate(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    />
                                </div>
                                
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Start Date
                                    </label>
                                    <input
                                        type="date"
                                        value={editStartDate}
                                        onChange={(e) => setEditStartDate(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 p-4 border-t bg-gray-50 rounded-b-lg">
                            <button
                                onClick={closeEditModal}
                                className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={submitEdit}
                                disabled={submittingEdit || !editSummary.trim()}
                                className="px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-md hover:bg-orange-700 disabled:opacity-50 inline-flex items-center gap-2"
                            >
                                {submittingEdit ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <>
                                        <Save className="w-4 h-4" />
                                        Save Changes
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
