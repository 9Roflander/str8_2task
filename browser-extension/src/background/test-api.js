/**
 * Mock LLM API for testing message generation
 * This simulates what the real str8_2task app will provide
 */

const testMessages = {
    acknowledgment: [
        "Thank you for sharing that insight.",
        "That's a great point, I appreciate the clarification.",
        "Understood, thanks for explaining.",
        "I see what you mean, that makes sense.",
        "Good to know, thank you!"
    ],
    question: [
        "Could you elaborate on that point?",
        "What are the next steps for this?",
        "How does this align with our timeline?",
        "Can you provide more details about the implementation?",
        "What would be the best approach here?"
    ],
    summary: [
        "To summarize: we'll proceed with the discussed approach.",
        "Let me recap the key points from this discussion.",
        "Just to confirm, we agreed on the following action items.",
        "In summary, the main takeaways are...",
        "To wrap up, here's what we've decided."
    ]
};

/**
 * Generate a test LLM message
 * @param {string} type - Type of message: 'acknowledgment', 'question', or 'summary'
 * @returns {Promise<string>} Generated message
 */
export async function generateTestMessage(type = 'acknowledgment') {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));

    const messages = testMessages[type] || testMessages.acknowledgment;
    const randomIndex = Math.floor(Math.random() * messages.length);

    return messages[randomIndex];
}

/**
 * This will be replaced with real API call to str8_2task app in Phase 2
 * @param {Object} context - Meeting context for LLM
 * @returns {Promise<string>} Generated message
 */
export async function generateLLMMessage(context) {
    // TODO: In Phase 2, this will call the str8_2task app API
    // For now, use test message generation
    return generateTestMessage(context.type || 'acknowledgment');
}
