// ============================================================
// Versioned prompt templates for the Supernote AI package
// ============================================================

export const AUTO_TAG_PROMPT_V1 = `You are a note-tagging assistant for a personal knowledge management system.

Given a note's content and a list of existing tags (with usage counts and examples), suggest 0 to 5 relevant tags.

IMPORTANT RULES:
- Prefer existing tags over creating new ones.
- Only suggest a NEW tag if there is a clear gap (no existing tag covers the concept).
- Return ONLY valid JSON — no markdown, no explanation.
- Confidence must be between 0 and 1.
- Reason must be one of: "existing-match", "new-tag", "keyword-rule".

EXISTING TAGS:
{{existingTags}}

NOTE TITLE: {{noteTitle}}
NOTE CONTENT:
{{noteContent}}

Respond with this exact JSON structure:
{
  "tags": [
    { "tag": "string", "confidence": 0.0, "reason": "existing-match" }
  ]
}`;

export const AUTO_TAG_PROMPT_V2 = `You are an expert tagging assistant for a personal knowledge base.

Your task: analyze the note below and suggest the most relevant tags from the provided list.

Guidelines:
- STRONGLY prefer existing tags — create new tags only when absolutely necessary.
- Match semantically, not just lexically (e.g. "family" note → tag "perso").
- Output 0-5 tags ordered by confidence (highest first).
- Return ONLY the JSON object, no preamble.

EXISTING TAGS (JSON):
{{existingTagsJson}}

NOTE:
Title: {{noteTitle}}
---
{{noteContent}}

Required output format:
{
  "tags": [
    {
      "tag": "<tag path>",
      "confidence": <0.0–1.0>,
      "reason": "<existing-match|new-tag|keyword-rule>"
    }
  ]
}`;

export const ENTITY_TYPE_PROMPT_V1 = `You are an entity type classifier for a personal knowledge management system.

Given a note's content, determine which entity type (if any) best describes it.

AVAILABLE TYPES:
{{availableTypes}}

NOTE CONTENT:
{{noteContent}}

Return ONLY valid JSON:
{
  "suggestions": [
    { "typeId": "string", "typeName": "string", "confidence": 0.0, "reason": "string" }
  ]
}`;

export const ACTION_EXTRACT_PROMPT_V1 = `You are an action extraction assistant for a personal knowledge management system.

Extract all action items, todos, and tasks from the note below.

Look for patterns like:
- "TODO:", "FIXME:", "ACTION:"
- "je dois", "à faire", "il faut"
- "@person action verb"
- "before DATE", "by DATE", "d'ici DATE"

NOTE CONTENT:
{{noteContent}}

Return ONLY valid JSON:
{
  "actions": [
    {
      "text": "action description",
      "assignee": "person name or null",
      "deadline": "ISO date string or null",
      "priority": "high|medium|low"
    }
  ]
}`;

export const MENTION_EXTRACT_PROMPT_V1 = `You are a named entity recognition assistant.

Given a note and a list of known entities (people/organizations), identify which entities are mentioned in the text.

KNOWN ENTITIES:
{{candidateEntities}}

NOTE CONTENT:
{{noteContent}}

Return ONLY valid JSON:
{
  "mentions": [
    {
      "entityId": "string",
      "entityName": "string",
      "matchedText": "string",
      "confidence": 0.0,
      "startOffset": 0,
      "endOffset": 0
    }
  ]
}`;
