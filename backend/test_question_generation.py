#!/usr/bin/env python3
"""
Test script for Jira-focused question generation.

This script simulates real-time transcript processing by:
1. Reading a transcript from a text file
2. Splitting it into chunks (simulating real-time transcription)
3. Maintaining a buffer of recent context (last 5 chunks)
4. Calling Ollama for each substantial chunk (>50 chars)
5. Logging all inputs and outputs

Usage:
    python test_question_generation.py <transcript_file.txt> [--model MODEL] [--endpoint URL]
"""

import sys
import json
import re
import argparse
from typing import List, Tuple
from datetime import datetime
import ollama

# Same prompt as in question_generator.rs
def build_prompt(recent_context: str, current_chunk: str) -> str:
    return f"""You are an AI Scrum Master preparing to create Jira tasks. Analyze this meeting transcript and identify ONLY critical missing information needed to create actionable Jira tasks.

Focus STRICTLY on:
- WHO will do the task? (assignee/owner)
- WHEN is it due? (deadline/sprint)
- WHAT exactly needs to be done? (clear task description)
- WHAT defines "done"? (acceptance criteria)
- HOW urgent is it? (priority)

Recent context:
{recent_context}

Current transcript:
{current_chunk}

Generate ONLY 1 concise question (max 50 words) if critical information is missing for Jira task creation.
Questions must be:
- Short and direct (under 50 words)
- Actionable (answer helps create Jira task)
- Focused on task assignment, deadlines, or clear requirements

Return ONLY a JSON array of strings. Example:
["Who should be assigned to this task?"]
or
["What is the deadline for this?"]

If everything needed for Jira task creation is clear, return: []"""

# Same filtering logic as in question_generator.rs
def filter_question(text: str) -> bool:
    trimmed = text.strip()
    if not trimmed or not trimmed.endswith('?'):
        return False
    
    if len(trimmed) < 10 or len(trimmed) > 150:
        return False
    
    lower = trimmed.lower()
    if any(phrase in lower for phrase in ["can you", "could you", "would you"]):
        return False
    
    # Must be Jira-relevant
    jira_keywords = ["who", "when", "what", "deadline", "assign", "due", "priority", "owner", "responsible"]
    if not any(keyword in lower for keyword in jira_keywords):
        return False
    
    return True

def parse_questions(response: str) -> List[str]:
    """Parse questions from LLM response (JSON array or plain text)."""
    questions = []
    
    # Clean response - remove code blocks
    cleaned = response.strip()
    if cleaned.startswith('```'):
        # Extract content from code blocks
        lines = cleaned.split('\n')
        cleaned = '\n'.join([l for l in lines if not l.strip().startswith('```')])
    
    # Try to parse as JSON array first
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            questions = [str(q).strip() for q in parsed if isinstance(q, str)]
        elif isinstance(parsed, dict) and 'questions' in parsed:
            # Handle case where LLM returns {"questions": [...]}
            questions = [str(q).strip() for q in parsed['questions'] if isinstance(q, str)]
    except json.JSONDecodeError:
        # Try to extract JSON objects like {"question"} or ["question"]
        import re
        # Find all quoted strings that end with ?
        quoted_questions = re.findall(r'["\']([^"\']+\?)["\']', cleaned)
        questions.extend(quoted_questions)
        
        # Also try line-by-line extraction
        for line in cleaned.split('\n'):
            line = line.strip()
            # Remove JSON formatting
            line = re.sub(r'^[\[\{"]', '', line)
            line = re.sub(r'["\}\]]+$', '', line)
            line = line.strip()
            if line.endswith('?') and len(line) > 10:
                questions.append(line)
    
    # Remove duplicates and apply filtering
    seen = set()
    filtered = []
    for q in questions:
        q_clean = q.strip().strip('"').strip("'")
        if q_clean and q_clean not in seen:
            seen.add(q_clean)
            if filter_question(q_clean):
                filtered.append(q_clean)
    
    return filtered

def split_into_chunks(text: str, chunk_size: int = 200) -> List[str]:
    """
    Split transcript into chunks, trying to break at sentence boundaries.
    Simulates how real-time transcription might chunk the text.
    """
    # Split by sentences (period, exclamation, question mark followed by space)
    sentences = re.split(r'([.!?]\s+)', text)
    
    chunks = []
    current_chunk = ""
    
    for i in range(0, len(sentences), 2):
        sentence = sentences[i] + (sentences[i+1] if i+1 < len(sentences) else "")
        
        if len(current_chunk) + len(sentence) > chunk_size and current_chunk:
            chunks.append(current_chunk.strip())
            current_chunk = sentence
        else:
            current_chunk += sentence
    
    if current_chunk.strip():
        chunks.append(current_chunk.strip())
    
    return chunks

def test_question_generation(
    transcript_file: str,
    model: str = "llama3.2:1b",
    endpoint: str = "http://localhost:11434",
    max_chunks: int = 15
):
    """Main test function."""
    
    print("=" * 80)
    print("JIRA QUESTION GENERATION TEST")
    print("=" * 80)
    print(f"Model: {model}")
    print(f"Endpoint: {endpoint}")
    print(f"Transcript file: {transcript_file}")
    print(f"Max chunks to process: {max_chunks}")
    print("=" * 80)
    print()
    
    # Read transcript
    try:
        with open(transcript_file, 'r', encoding='utf-8') as f:
            transcript = f.read().strip()
    except FileNotFoundError:
        print(f"ERROR: File not found: {transcript_file}")
        return
    except Exception as e:
        print(f"ERROR: Failed to read file: {e}")
        return
    
    print(f"📄 Loaded transcript: {len(transcript)} characters")
    print()
    
    # Split into chunks (simulating real-time transcription)
    chunks = split_into_chunks(transcript, chunk_size=200)
    print(f"📦 Split into {len(chunks)} chunks")
    print()
    
    # Maintain buffer of recent context (last 5 chunks, like frontend)
    context_buffer: List[str] = []
    all_questions: List[Tuple[int, str, str, List[str]]] = []  # (chunk_idx, chunk, context, questions)
    
    # Process each chunk (limit to max_chunks for testing)
    chunks_to_process = [c for c in chunks if len(c.strip()) > 50][:max_chunks]
    
    for idx, chunk in enumerate(chunks_to_process, 1):
        chunk = chunk.strip()
        
        if len(chunk) <= 50:
            continue
        
        # Build recent context (last 5 chunks, excluding current)
        recent_context = '\n'.join(context_buffer[-5:]) if context_buffer else ""
        
        print("=" * 80)
        print(f"🔍 PROCESSING CHUNK {idx}/{len(chunks_to_process)}")
        print("=" * 80)
        print(f"📝 Chunk text ({len(chunk)} chars):")
        print(f"   {chunk[:200]}{'...' if len(chunk) > 200 else ''}")
        print()
        
        if recent_context:
            print(f"📚 Recent context ({len(recent_context)} chars):")
            print(f"   {recent_context[:300]}{'...' if len(recent_context) > 300 else ''}")
            print()
        else:
            print("📚 Recent context: (none - first chunk)")
            print()
        
        # Build prompt
        prompt = build_prompt(recent_context, chunk)
        print(f"💬 Prompt length: {len(prompt)} chars")
        print()
        
        # Call Ollama
        print("🤖 Calling Ollama...")
        try:
            import time
            start_time = time.time()
            response = ollama.chat(
                model=model,
                messages=[
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                options={
                    "num_predict": 100,  # Limit response length for faster responses
                    "temperature": 0.7
                }
            )
            elapsed = time.time() - start_time
            print(f"⏱️  LLM call took {elapsed:.2f} seconds")
            
            raw_response = response['message']['content']
            print(f"✅ Raw LLM response ({len(raw_response)} chars):")
            print(f"   {raw_response[:500]}{'...' if len(raw_response) > 500 else ''}")
            print()
            
            # Parse questions
            questions = parse_questions(raw_response)
            
            if questions:
                print(f"❓ Generated {len(questions)} question(s):")
                for q in questions:
                    print(f"   • {q}")
                all_questions.append((idx, chunk, recent_context, questions))
            else:
                print("✅ No questions generated (all information clear)")
            
        except Exception as e:
            print(f"❌ ERROR calling Ollama: {e}")
            import traceback
            traceback.print_exc()
        
        print()
        
        # Update context buffer (keep last 5, like frontend)
        context_buffer.append(chunk)
        if len(context_buffer) > 5:
            context_buffer.pop(0)
    
    # Summary
    print()
    print("=" * 80)
    print("📊 TEST SUMMARY")
    print("=" * 80)
    print(f"Total chunks processed: {len(chunks_to_process)}")
    print(f"Chunks that generated questions: {len(all_questions)}")
    print(f"Total questions generated: {sum(len(q[3]) for q in all_questions)}")
    print()
    
    if all_questions:
        print("📋 ALL GENERATED QUESTIONS:")
        print("-" * 80)
        for chunk_idx, chunk, context, questions in all_questions:
            print(f"\nChunk {chunk_idx}:")
            print(f"  Trigger: {chunk[:100]}...")
            for q in questions:
                print(f"  ❓ {q}")
    else:
        print("ℹ️  No questions were generated during the test.")
    
    print()
    print("=" * 80)
    print("✅ Test complete!")
    print("=" * 80)

def main():
    parser = argparse.ArgumentParser(
        description="Test Jira-focused question generation with incremental transcript chunks"
    )
    parser.add_argument(
        "transcript_file",
        help="Path to transcript text file"
    )
    parser.add_argument(
        "--model",
        default="llama3.2:1b",
        help="Ollama model to use (default: llama3.2:1b)"
    )
    parser.add_argument(
        "--endpoint",
        default="http://localhost:11434",
        help="Ollama endpoint (default: http://localhost:11434)"
    )
    parser.add_argument(
        "--max-chunks",
        type=int,
        default=15,
        help="Maximum number of chunks to process (default: 15)"
    )
    
    args = parser.parse_args()
    
    # Set Ollama endpoint if custom
    if args.endpoint != "http://localhost:11434":
        import os
        os.environ["OLLAMA_HOST"] = args.endpoint
    
    test_question_generation(
        args.transcript_file,
        args.model,
        args.endpoint,
        args.max_chunks
    )

if __name__ == "__main__":
    main()

