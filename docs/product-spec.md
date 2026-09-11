# AI Project Memory — Complete Product Context

## 1. Core Idea

We are building an **AI-powered Project Memory and Reasoning System**.

The system is not just an AI meeting summarizer. Its purpose is to maintain a **living memory of a project** across meetings, decisions, tasks, commitments, deadlines, communication, and development activity.

The central problem is:

> Teams have meetings, make decisions, assign tasks, promise deadlines, discuss changes, and communicate across different tools. After a few weeks, people forget why something was decided, who committed to what, what changed, what is blocked, and which previous decision is being contradicted.

Our system continuously converts project activity into structured memory and uses that memory to understand the **current state of the project**.

The final system should be able to answer questions such as:

- What happened in the last meeting?
- What decisions have been made?
- Who committed to what?
- What was the committed deadline?
- What has changed since the previous meeting?
- Why did this change?
- What tasks are overdue?
- What is currently blocked?
- Which commitments are at risk?
- Are there contradictions between old and new decisions?
- What should happen next?
- Who is responsible for the next action?
- What did we originally agree upon?
- Why are we doing this task?
- What changed from the original plan?

The core concept is:

**Meetings + Project Activity → Structured Memory → State Changes → Reasoning → Actionable Answers**

---

# 2. What Makes This Different From Meeting Summarization?

A normal AI meeting tool produces:

**Meeting → Transcript → Summary**

Our system should produce:

**Meeting → Understanding → Structured Project Memory → Change Detection → Reasoning**

For example:

### Meeting 1

> "Rahul will complete the payment API by Friday."

The system stores:

- Person: Rahul
- Task: Payment API
- Action: Complete integration
- Commitment: Rahul committed to completing it
- Deadline: Friday
- Source: Meeting 1
- Confidence: High

### Meeting 2

> "The payment API is still incomplete because the gateway documentation was delayed."

The system should understand:

- Original commitment still exists
- Task is incomplete
- Deadline may be at risk
- A blocker has appeared
- The reason for delay is gateway documentation
- This is a state change from the previous project state

Now the AI can answer:

> "Why is the payment API delayed?"

Instead of simply saying:

> "The payment API is incomplete."

This distinction is the core value of the product.

---

# 3. High-Level System Flow

```text
                    ┌─────────────────┐
                    │     MEETING     │
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │   UNDERSTAND    │
                    │   Transcript    │
                    └────────┬────────┘
                             ↓
          ┌──────────────────┼──────────────────┐
          ↓                  ↓                  ↓
      SUMMARY            DECISIONS           ACTIONS
                                                ↓
                                           DEADLINES
                                                ↓
                                           OWNERS
                                                ↓
                                        COMMITMENTS
                                                ↓
                    ┌───────────────────────────┐
                    │      PROJECT MEMORY       │
                    └─────────────┬─────────────┘
                                  ↓
             ┌────────────────────┼───────────────────┐
             ↓                    ↓                   ↓
         NEW MEETING          GIT/NOTION            SLACK
             └────────────────────┬───────────────────┘
                                  ↓
                         ┌─────────────────┐
                         │  STATE CHANGES  │
                         └────────┬────────┘
                                  ↓
               ┌──────────────────┼─────────────────┐
               ↓                  ↓                 ↓
         CONTRADICTIONS         RISKS          COMMITMENTS
               └──────────────────┼─────────────────┘
                                  ↓
                         ┌─────────────────┐
                         │  AI REASONING   │
                         └────────┬────────┘
                                  ↓
              ┌───────────────────┼───────────────────┐
              ↓                   ↓                   ↓
        "Why changed?"     "What's blocked?"     "What's next?"
```

---

# 4. Main Components

## A. Meeting Ingestion

The system receives meeting information through:

- Audio/video recording
- Uploaded audio file
- Uploaded transcript
- Meeting transcript from an integration
- Manual notes

For an MVP, we can start with:

**Audio file → Speech-to-text → AI extraction**

Later we can integrate platforms such as:

- Google Meet
- Zoom
- Microsoft Teams

The system should retain the original transcript because extracted information may need to be verified later.

---

# 5. Transcription

If audio is provided:

```text
Audio
 ↓
Speech-to-text
 ↓
Timestamped transcript
 ↓
Speaker identification
 ↓
LLM analysis
```

Possible technology:

### Option 1 — OpenAI

Use a modern OpenAI speech/transcription model/API.

Advantages:

- Easy integration
- Good ecosystem
- Simple API architecture
- Can combine transcription and downstream reasoning

### Option 2 — Whisper

Use Whisper locally or through an API.

Advantages:

- Open-source ecosystem
- Can potentially run locally
- Useful if privacy becomes important

For the MVP:

**Use an API-based transcription service first.**

Do not spend the initial development time building your own speech recognition system.

---

# 6. Speaker Identification

The system should ideally know who said what.

Example:

```text
[10:23] Rahul:
"I will complete the payment integration by Friday."

[10:25] Priya:
"Okay, I'll handle the frontend integration."
```

This is important because commitments need an owner.

Potential fields:

```text
speaker_id
speaker_name
timestamp
text
confidence
```

If speaker identification is unavailable, the system should not invent identities.

Instead:

```text
Speaker 1
Speaker 2
Unknown speaker
```

and allow the user to map them manually.

---

# 7. Meeting Understanding

The LLM should extract structured information instead of only producing prose.

For every meeting, extract:

### Summary

What was discussed?

### Decisions

What was officially agreed upon?

### Action Items

What needs to be done?

### Owner

Who is responsible?

### Deadline

When should it be completed?

### Commitment

Did someone explicitly commit to completing it?

### Blocker

Is something preventing progress?

### Risk

Could something negatively affect the project?

### Dependencies

Does one task depend on another?

### Context

Why was the decision made?

### References

What previous decision/task does this relate to?

---

# 8. Important Distinction: Action vs Commitment

The AI must distinguish between:

### Action

> "The payment API needs to be integrated."

This means something needs to happen.

### Assignment

> "Rahul will integrate the payment API."

Now there is an owner.

### Commitment

> "Rahul will integrate the payment API by Friday."

Now there is:

- Owner
- Action
- Deadline
- Explicit commitment

This distinction is extremely important for project-memory reasoning.

---

# 9. Project Memory

The project memory is the heart of the application.

It should store more than meeting summaries.

Possible memory objects:

```text
Project
 ├── Meetings
 ├── Decisions
 ├── Tasks
 ├── Commitments
 ├── Deadlines
 ├── People
 ├── Risks
 ├── Blockers
 ├── Dependencies
 ├── Changes
 ├── Contradictions
 └── Sources
```

Every important piece of information should have a source.

For example:

```text
Decision:
"Use PostgreSQL instead of MongoDB."

Source:
Meeting #12
Timestamp:
24:31
Speaker:
Project Lead
Created:
August 20
```

This makes the system explainable.

---

# 10. Memory Must Be Time-Aware

The system should not simply overwrite old information.

Example:

### August 1

> "Launch on September 1."

### August 15

> "Launch moved to September 15."

The system should preserve:

```text
Original deadline:
September 1

New deadline:
September 15

Change:
+14 days

Reason:
Payment provider integration delayed

Source:
August 15 meeting
```

This allows the AI to answer:

> "Why was the launch delayed?"

without losing historical context.

---

# 11. State Changes

Every new piece of information should be compared against existing project memory.

Possible state changes:

### New

A new task/decision/commitment appears.

### Updated

Existing information changes.

### Completed

A task has been completed.

### Delayed

A task remains incomplete after its expected deadline.

### Cancelled

A task or decision is no longer applicable.

### Reassigned

The owner changes.

### Deadline Changed

The committed date changes.

### Blocked

Progress cannot continue because of a dependency/problem.

### Unblocked

A previous blocker has been resolved.

### Contradicted

New information conflicts with previous information.

---

# 12. Contradiction Detection

This is one of the most valuable features.

Example:

Meeting 1:

> "We will use PostgreSQL."

Meeting 3:

> "We're going with MongoDB."

The system should detect:

```text
Previous decision:
PostgreSQL

New decision:
MongoDB

Conflict:
Database technology changed

Question:
Was the previous decision intentionally replaced?
```

Not every difference is a contradiction.

The AI needs to classify changes as:

- Intentional change
- Correction
- Contradiction
- Additional information
- Temporary exception
- Unclear

If uncertain, it should ask the user instead of confidently declaring a contradiction.

---

# 13. Commitment Tracking

The system should maintain a commitment ledger.

Example:

| PersonCommitmentDeadlineStatus |                    |        |             |
| ------------------------------ | ------------------ | ------ | ----------- |
| Rahul                          | Payment API        | Aug 25 | At Risk     |
| Priya                          | UI redesign        | Aug 27 | In Progress |
| Aman                           | Database migration | Aug 23 | Overdue     |

Each commitment should have:

- Owner
- Description
- Created date
- Committed date
- Current status
- Completion date
- Source
- Related task
- Related decision
- Risk level
- Blockers
- Change history

---

# 14. Deadlines

Deadlines can be expressed in many ways:

### Explicit

> "By August 30."

### Relative

> "Tomorrow."

### Day-based

> "By Friday."

### Approximate

> "Around next week."

### Conditional

> "After the API is ready."

### Ambiguous

> "Soon."

The system should normalize dates when possible.

Example:

```text
"Friday"
→ 2026-08-28
```

But only if the meeting date/time is known.

For ambiguous dates, retain the original language rather than inventing precision.

---

# 15. Time and Date Edge Cases

Important cases:

- "Tomorrow" depends on meeting date.
- "Friday" depends on calendar context.
- Different time zones.
- Midnight crossing.
- "End of day."
- "Next Monday."
- "This weekend."
- "Next sprint."
- "In two weeks."
- Fiscal/project-specific deadlines.
- Deadlines changed multiple times.
- Deadline removed.
- Deadline extended.
- Task completed before deadline.
- Task completed after deadline.
- Deadline passes without status update.

The database should store both:

```text
original_deadline_text
normalized_deadline
timezone
```

---

# 16. Blocker Detection

The system should identify statements such as:

> "We can't deploy until DevOps gives us production credentials."

This creates:

```text
Task:
Deploy application

Blocked by:
Production credentials

Dependency:
DevOps

Status:
Blocked
```

Blockers can be:

- Technical
- Human
- Approval-related
- External dependency
- Resource-related
- Financial
- Scheduling-related
- Access/permission-related

---

# 17. Risk Detection

Risks are different from blockers.

### Blocker

Something is already preventing progress.

### Risk

Something may cause a problem.

Example:

> "If the API isn't ready by Friday, the launch will be delayed."

This is a risk.

The AI should ideally identify:

```text
Risk:
Launch delay

Trigger:
API not ready by Friday

Impact:
Launch date affected

Probability:
Medium

Related commitment:
Rahul - API integration
```

Risk scoring can initially be AI-generated but should be treated as an estimate, not fact.

---

# 18. Integrations

The project memory can combine information from:

### Meetings

Primary source of decisions and commitments.

### Slack

Useful for:

- Informal updates
- Blockers
- Changes
- Clarifications
- Decisions made outside meetings

### GitHub

Useful for:

- Commits
- Pull requests
- Issues
- Releases
- Code activity

### Notion

Useful for:

- Documentation
- Project decisions
- Task tracking
- Requirements

### Jira/Trello/Linear

Useful for:

- Task status
- Assignments
- Deadlines

For the MVP, do not integrate everything.

Recommended initial stack:

```text
Meeting
+
Slack OR GitHub
+
Manual project memory
```

Then expand.

---

# 19. Source of Truth

Different sources can disagree.

For example:

Meeting:

> "The deadline is Friday."

Project management tool:

> Deadline = Monday.

The system should not blindly choose one.

Instead it should show:

```text
Possible conflict detected.

Meeting:
Friday

Project tracker:
Monday

Which deadline should be considered authoritative?
```

This is safer than silently modifying data.

---

# 20. AI Reasoning Layer

The reasoning layer should not operate only on the latest meeting.

It should retrieve relevant project memory first.

For a question:

> "Why is the launch delayed?"

The system should retrieve:

```text
Launch decision
Original deadline
Deadline changes
Relevant meetings
Related tasks
Commitments
Blockers
Slack messages
GitHub activity
```

Then reason over this context.

Conceptually:

```text
User Question
      ↓
Query Understanding
      ↓
Memory Retrieval
      ↓
Relevant Timeline
      ↓
LLM Reasoning
      ↓
Answer + Evidence
```

---

# 21. RAG Architecture

Use **Retrieval-Augmented Generation (RAG)**.

Do not send the entire project history to the LLM every time.

Instead:

```text
Question
 ↓
Embedding / semantic search
 +
Metadata filtering
 +
Relationship traversal
 ↓
Relevant memories
 ↓
LLM
 ↓
Answer
```

Retrieval should consider:

- Semantic similarity
- Project ID
- Date
- Person
- Task
- Meeting
- Status
- Source
- Entity relationships

---

# 22. Vector Database

Possible options:

### PostgreSQL + pgvector

Recommended for MVP.

Why:

- One primary database
- Relational data + vectors together
- Easier deployment
- Supports structured queries
- Supports semantic search

Alternative:

- Pinecone
- Qdrant
- Weaviate
- MongoDB Vector Search

But avoid introducing a separate vector database unless necessary.

---

# 23. Recommended Database

### PostgreSQL

Use PostgreSQL for the core project memory.

Possible tables:

```text
users
projects
project_members
meetings
transcripts
transcript_segments
people
decisions
tasks
commitments
deadlines
blockers
risks
dependencies
state_changes
contradictions
sources
integrations
messages
documents
embeddings
audit_logs
```

Important relationships:

```text
Project
  ↓
Meeting
  ↓
Transcript
  ↓
Extracted entities
  ↓
Tasks / Decisions / Commitments
  ↓
State Changes
  ↓
Risks / Contradictions / Blockers
```

---

# 24. Entity Relationships

A task should not exist as an isolated piece of text.

Example:

```text
Task
 ├── belongs to Project
 ├── created from Meeting
 ├── assigned to Person
 ├── has Deadline
 ├── has Commitment
 ├── depends on Task
 ├── has Blocker
 ├── has Status History
 └── has Source Evidence
```

A decision:

```text
Decision
 ├── belongs to Project
 ├── made in Meeting
 ├── made by Person
 ├── may supersede another Decision
 ├── affects Tasks
 └── has Evidence
```

---

# 25. Technology Stack

## Frontend

Recommended:

- React
- Vite
- TypeScript
- Tailwind CSS
- React Query / TanStack Query
- React Router

UI sections:

```text
Dashboard
Meetings
Meeting Detail
Project Timeline
Commitments
Tasks
Decisions
Risks
Blockers
Contradictions
AI Chat
```

---

# 26. Backend

Recommended:

### Node.js + TypeScript

Framework:

### Express or Fastify

For a hackathon/MVP:

**Node.js + Express + TypeScript**

is sufficient.

Architecture:

```text
Routes
 ↓
Controllers
 ↓
Services
 ↓
AI / Integration Layer
 ↓
Database
```

Do not put AI logic directly inside route handlers.

---

# 27. AI Service Layer

Create a dedicated service:

```text
AI Service
 ├── transcription
 ├── meeting extraction
 ├── entity extraction
 ├── commitment extraction
 ├── contradiction detection
 ├── state change detection
 ├── risk detection
 ├── query understanding
 └── project reasoning
```

This makes it easier to change LLM providers later.

---

# 28. LLM

Possible choices:

- OpenAI
- Anthropic
- Gemini
- Open-source models

The important part is not simply which model is used.

The architecture should make the model **replaceable**.

Create an abstraction:

```text
LLMProvider
 ├── extractMeeting()
 ├── detectChanges()
 ├── answerQuestion()
 └── analyzeRisk()
```

Then the application does not depend directly on one provider.

---

# 29. Structured AI Output

Do not ask the LLM:

> "Summarize this meeting."

and then parse random text.

Instead request structured output.

Example conceptual schema:

```json
{
  "summary": "...",
  "decisions": [],
  "actions": [],
  "commitments": [],
  "risks": [],
  "blockers": [],
  "questions": []
}
```

Every extracted entity should have evidence.

Example:

```json
{
  "task": "Complete payment API integration",
  "owner": "Rahul",
  "deadline": "2026-08-28",
  "commitment": true,
  "evidence": {
    "timestamp": "00:32:14",
    "text": "..."
  }
}
```

This makes hallucination easier to detect.

---

# 30. Evidence-Based AI

Every important AI-generated conclusion should ideally have a source.

Instead of:

> "The project is delayed because Rahul is behind."

Prefer:

> "The payment integration is currently at risk because the original commitment was August 25 and the latest project update still marks the task as incomplete. The latest meeting also mentions missing gateway documentation."

Then show the relevant source.

The system should distinguish:

```text
FACT
INFERENCE
AI ESTIMATE
UNKNOWN
```

This is extremely important.

---

# 31. Confidence

Every AI extraction can have a confidence score or confidence category.

Example:

```text
High:
Explicit statement

Medium:
Strongly implied

Low:
Weak inference
```

For example:

> "We'll probably finish next week."

Should not become:

```text
Deadline: September 1
```

It should become:

```text
Approximate timeframe:
Next week

Confidence:
Low/Medium
```

---

# 32. Complete Processing Workflow

## Step 1 — User creates project

```text
Create Project
 ↓
Add team members
 ↓
Connect integrations
```

## Step 2 — Meeting is uploaded

```text
Audio / Transcript
 ↓
Store original source
```

## Step 3 — Transcription

```text
Audio
 ↓
Speech-to-text
 ↓
Timestamped transcript
```

## Step 4 — Meeting extraction

LLM extracts:

```text
Summary
Decisions
Actions
Owners
Deadlines
Commitments
Blockers
Risks
Dependencies
Questions
```

## Step 5 — Entity resolution

Match:

```text
"Rahul"
"Rahul Patel"
"@rahul"
```

to the same project member when possible.

Do not merge people automatically when confidence is low.

## Step 6 — Memory update

Compare new entities with existing project memory.

## Step 7 — Change detection

Detect:

```text
New
Updated
Completed
Delayed
Cancelled
Reassigned
Contradicted
Blocked
Unblocked
```

## Step 8 — Timeline update

Create a chronological project history.

## Step 9 — Risk/commitment analysis

Check:

```text
Upcoming deadlines
Overdue commitments
Repeated blockers
Unresolved contradictions
Dependency failures
```

## Step 10 — AI reasoning

Allow users to ask questions about the project.

---

# 33. Example End-to-End Scenario

### Meeting 1

> "Aman will build the authentication API by Monday."

Memory:

```text
Task:
Authentication API

Owner:
Aman

Deadline:
Monday

Commitment:
Yes

Status:
Committed
```

### Slack

> "Still waiting for API credentials."

Memory update:

```text
Blocker:
API credentials

Task:
Authentication API

Status:
Blocked
```

### Meeting 2

> "Authentication API won't be ready Monday because credentials haven't arrived."

System detects:

```text
Original commitment:
Monday

Current state:
Blocked

Reason:
Missing credentials

Risk:
Deadline may be missed
```

### Meeting 3

> "Credentials arrived. Aman will finish by Wednesday."

System records:

```text
Old deadline:
Monday

New deadline:
Wednesday

Reason:
Credential dependency

Status:
Unblocked

Commitment:
Updated
```

Now user asks:

> "Why did authentication move from Monday to Wednesday?"

The system can produce a timeline-backed answer.

---

# 34. Edge Cases

## Meeting-related

- Meeting has no transcript.
- Poor audio quality.
- Multiple people speaking simultaneously.
- Speaker identification fails.
- People interrupt each other.
- Same person appears with multiple names.
- Meeting contains unrelated discussion.
- Meeting is cancelled.
- Meeting transcript is duplicated.
- Same recording uploaded twice.
- Meeting has multiple languages.
- Technical terminology is mis-transcribed.
- Someone makes a joke that sounds like a commitment.
- Hypothetical statements are mistaken for decisions.

---

## Decision edge cases

- Decision is tentative.
- Decision is later reversed.
- Decision has no clear owner.
- Multiple people disagree.
- Decision is made outside the meeting.
- Two meetings contain conflicting decisions.
- Decision is obsolete.
- Decision applies only temporarily.

The system should distinguish:

```text
Proposed
Tentative
Approved
Rejected
Superseded
Cancelled
Unknown
```

---

## Task edge cases

- Task has no owner.
- Multiple owners.
- Task is duplicated.
- Task description changes.
- Task is split into subtasks.
- Task is merged with another task.
- Task is cancelled.
- Task is completed without a meeting mentioning it.
- Task is completed before the deadline.
- Task remains incomplete after deadline.
- Task depends on another task.
- Task is blocked by an external party.

---

## Commitment edge cases

- "I can probably do it."
- "We'll try to finish it."
- "Someone should do it."
- "I'll take a look."
- "I'll definitely finish it."
- Commitment is withdrawn.
- Commitment is reassigned.
- Commitment deadline changes.
- Person makes conflicting commitments.
- Commitment is conditional.

The AI should not treat every future-tense statement as a firm commitment.

---

## Deadline edge cases

- "Tomorrow"
- "Next Friday"
- "By EOD"
- "By end of week"
- "Next sprint"
- "Soon"
- "After X is completed"
- Timezone differences
- Deadline changes
- Deadline removed
- Ambiguous dates
- Relative dates in old transcripts

---

## Contradiction edge cases

Not every change is a contradiction.

Example:

Old:

> "We'll use MongoDB."

New:

> "For the analytics service we'll use PostgreSQL."

This may be an expansion rather than a contradiction.

The AI needs context:

```text
Scope changed?
Service changed?
Decision superseded?
Temporary exception?
Actually contradictory?
```

If uncertain:

**Flag for human review.**

---

# 35. Hallucination Prevention

This is a major technical requirement.

The AI must never invent:

- People
- Deadlines
- Decisions
- Commitments
- Reasons
- Project status

Use:

### Source evidence

Every extracted fact should point to its source.

### Structured output

Use schema validation.

### Confidence

Record confidence.

### Human confirmation

Important decisions/commitments can require confirmation.

### Retrieval

Answers should be based on retrieved project memory.

### No-evidence policy

If the system cannot find evidence:

> "I couldn't find enough evidence in the project memory to determine this."

Do not guess.

---

# 36. Human-in-the-Loop

Not every AI decision should automatically change project state.

For high-impact changes:

```text
AI detects:
"Deadline changed from Aug 25 to Aug 28."

UI:
Confirm change?

[Confirm] [Reject] [Edit]
```

This is particularly useful for:

- Deadline changes
- Major decisions
- Contradictions
- Person assignment
- Commitment creation

---

# 37. Project Timeline

The UI should have a timeline showing:

```text
Aug 20
Decision:
Use PostgreSQL

Aug 21
Task:
Database migration assigned to Rahul

Aug 22
Blocker:
Migration blocked by schema approval

Aug 23
Deadline changed:
Aug 25 → Aug 28

Aug 24
Status:
Migration in progress
```

This becomes the visual representation of **project memory**.

---

# 38. AI Chat

The user can ask:

### Historical

> What did we decide about the database?

### Causal

> Why was the deadline changed?

### Status

> What's currently blocked?

### Accountability

> What commitments does Rahul currently have?

### Risk

> What deadlines are at risk this week?

### Planning

> What should we focus on next?

### Comparison

> What changed since last week's meeting?

### Contradiction

> Are we following the same architecture we originally decided?

---

# 39. "What Changed?" Feature

This should be a dedicated feature, not only a chat question.

Example:

```text
SINCE LAST MEETING

✓ Payment API moved from In Progress → Blocked

✓ Launch deadline changed
  Sep 1 → Sep 15

✓ Rahul's commitment is now at risk

✓ New dependency added:
  Payment gateway documentation

⚠ Architecture decision requires review
```

This provides immediate value to managers/team members who missed meetings.

---

# 40. "What's Blocked?" Feature

Show:

```text
BLOCKED TASKS

Payment API
 └─ Blocked by gateway documentation
 └─ Owner: Rahul
 └─ Deadline: Aug 28

Database Migration
 └─ Blocked by schema approval
 └─ Owner: Priya
 └─ Deadline: Aug 30
```

---

# 41. "What's Next?" Feature

The AI should consider:

- Current incomplete tasks
- Upcoming deadlines
- Dependencies
- Risks
- Blockers
- Recent decisions
- Commitments

Then generate:

```text
NEXT PRIORITIES

1. Resolve gateway documentation blocker.
2. Complete payment API integration.
3. Verify database migration.
4. Review launch deadline risk.
```

The AI should explain why each recommendation exists.

---

# 42. Security and Privacy

Meeting data can be highly sensitive.

Important requirements:

- Authentication
- Authorization
- Project-level access control
- Encryption in transit
- Encryption at rest where supported
- Secure API keys
- No exposing one project's memory to another
- Audit logs
- Integration permission management
- Ability to delete project data
- Clear retention policy

For AI APIs, verify the provider's current data-retention and training policies before production deployment.

---

# 43. Multi-Tenant Architecture

If this becomes a SaaS product:

```text
Organization
 ├── Users
 ├── Projects
 │    ├── Meetings
 │    ├── Tasks
 │    └── Memory
 └── Integrations
```

Every database query must be scoped by:

```text
organization_id
project_id
```

A user from Project A must never retrieve Project B's memory.

---

# 44. Recommended MVP

Do NOT build everything initially.

The strongest MVP should be:

```text
1. Create project
2. Upload meeting audio/transcript
3. Transcribe if necessary
4. Extract:
   - Summary
   - Decisions
   - Actions
   - Owners
   - Deadlines
   - Commitments
   - Blockers
5. Store structured memory
6. Generate project timeline
7. Detect changes between meetings
8. Track commitments
9. AI chat over project memory
10. Show evidence for AI answers
```

This is enough to demonstrate the core innovation.

---

# 45. MVP Technology Stack

Recommended:

```text
Frontend:
React + Vite + TypeScript
Tailwind CSS

Backend:
Node.js + Express + TypeScript

Database:
PostgreSQL

Vector Search:
pgvector

ORM:
Drizzle ORM or Prisma

Authentication:
Clerk / Auth.js / Supabase Auth
(or simple JWT for prototype)

AI:
OpenAI API or another LLM provider

Transcription:
OpenAI transcription / Whisper

Storage:
S3-compatible object storage
or Supabase Storage

Deployment:
Frontend → Vercel
Backend → Render / Railway / Fly.io
Database → Supabase / Neon / Railway

Version Control:
GitHub
```

For a hackathon, **Supabase + React + Node + PostgreSQL/pgvector + LLM API** can significantly reduce infrastructure work.

---

# 46. Suggested Backend Architecture

```text
backend/
│
├── src/
│   ├── controllers/
│   │   ├── meeting.controller.ts
│   │   ├── project.controller.ts
│   │   ├── task.controller.ts
│   │   └── chat.controller.ts
│   │
│   ├── services/
│   │   ├── transcription.service.ts
│   │   ├── meetingAnalysis.service.ts
│   │   ├── memory.service.ts
│   │   ├── changeDetection.service.ts
│   │   ├── commitment.service.ts
│   │   ├── risk.service.ts
│   │   ├── retrieval.service.ts
│   │   └── reasoning.service.ts
│   │
│   ├── db/
│   │   ├── schema/
│   │   ├── migrations/
│   │   └── client.ts
│   │
│   ├── integrations/
│   │   ├── slack/
│   │   ├── github/
│   │   └── notion/
│   │
│   ├── ai/
│   │   ├── prompts/
│   │   ├── schemas/
│   │   └── providers/
│   │
│   ├── routes/
│   ├── middleware/
│   └── app.ts
```

Keep AI extraction, memory management, and integrations as separate services.

---

# 47. Important Data Model Concept

A very useful abstraction is:

```text
Source → Claim → Entity → State → Change
```

Example:

```text
Source:
Meeting transcript

Claim:
"Rahul will finish API by Friday."

Entity:
Payment API

Person:
Rahul

State:
Committed

Deadline:
Friday

Later Source:
"API is blocked."

New State:
Blocked

Change:
Committed → Blocked
```

This makes the project memory explainable and traceable.

---

# 48. Event-Based Architecture

Eventually, the system can use events:

```text
MeetingProcessed
       ↓
DecisionExtracted
       ↓
CommitmentCreated
       ↓
TaskUpdated
       ↓
DeadlineChanged
       ↓
RiskDetected
       ↓
ProjectStateUpdated
```

For MVP, these can simply be backend service calls.

Later, use:

- Redis/BullMQ
- Kafka
- RabbitMQ
- Cloud queues

for asynchronous processing.

Do not introduce Kafka for the MVP unless there is a genuine need.

---

# 49. Asynchronous Processing

Meeting processing may take time.

Do not make the upload request wait for the entire AI pipeline.

Instead:

```text
Upload
 ↓
Create processing job
 ↓
Return immediately
 ↓
Background worker
 ↓
Transcription
 ↓
Extraction
 ↓
Memory update
 ↓
Change detection
 ↓
Notification
```

UI:

```text
Meeting uploaded
Status: Processing...

↓

Status: Analyzing...

↓

Status: Ready
```

For MVP:

**BullMQ + Redis** is a good option if background processing is required.

---

# 50. Failure Handling

Every pipeline stage can fail.

Example:

```text
Audio upload
     ↓
Transcription FAILED
```

The system should not lose the meeting.

Store:

```text
processing_status = FAILED
error_reason = ...
retry_count = ...
```

Allow:

```text
Retry processing
Upload transcript manually
Continue from failed stage
```

Also make processing idempotent so retrying does not create duplicate tasks or commitments.

---

# 51. Duplicate Detection

A meeting can accidentally be uploaded twice.

Potential detection:

- File hash
- Meeting ID
- Timestamp
- Duration
- Transcript similarity

Before processing:

```text
Possible duplicate meeting found.
```

Allow user to confirm.

---

# 52. Versioning

Never destroy historical information.

Instead of:

```text
deadline = Aug 28
```

simply overwriting:

Store:

```text
Aug 20 → Aug 25
Aug 23 → Aug 28
```

with source and reason.

This enables historical reasoning.

---

# 53. Evaluation

We need to evaluate whether the AI actually understands projects.

Create test cases for:

### Extraction accuracy

- Correct task?
- Correct owner?
- Correct deadline?
- Correct commitment?

### Change detection

- Correctly identified changes?
- False contradictions?

### Reasoning

- Does answer match evidence?
- Does it hallucinate?

### Retrieval

- Did the system retrieve the correct meeting?
- Did it retrieve historical context?

### Temporal reasoning

- Does it understand old vs new deadlines?

A benchmark dataset of synthetic meeting transcripts can be created for testing.

---

# 54. Most Important Product Principles

### Principle 1 — Memory over summaries

The goal is not to generate pretty notes.

The goal is to maintain project state.

### Principle 2 — History must never disappear

Old decisions and commitments should remain traceable.

### Principle 3 — Every important claim needs evidence

AI should show where information came from.

### Principle 4 — Never invent missing information

Unknown is better than hallucinated.

### Principle 5 — Distinguish facts from inference

The UI should make this clear.

### Principle 6 — Changes matter more than snapshots

The system should understand:

**Before → Change → After → Reason**

### Principle 7 — Human confirmation for high-impact changes

Especially deadlines, decisions, ownership, and contradictions.

---

# 55. Final Product Mental Model

Think of the application as having three layers.

## Layer 1 — Memory

"What do we know?"

```text
Meetings
Decisions
Tasks
Commitments
Deadlines
People
Risks
Blockers
```

## Layer 2 — State

"What changed?"

```text
New
Updated
Completed
Delayed
Blocked
Unblocked
Reassigned
Contradicted
Superseded
```

## Layer 3 — Reasoning

"What does it mean?"

```text
Why did this happen?
What's blocked?
What's at risk?
What changed?
What should happen next?
Who committed to what?
```

Therefore:

```text
                PROJECT ACTIVITY
                       ↓
              ┌─────────────────┐
              │     MEMORY      │
              └────────┬────────┘
                       ↓
              ┌─────────────────┐
              │     STATE       │
              └────────┬────────┘
                       ↓
              ┌─────────────────┐
              │    REASONING    │
              └────────┬────────┘
                       ↓
             ACTIONABLE PROJECT
                INTELLIGENCE
```

# 56. One-Line Product Definition

**An AI-powered project memory system that continuously converts meetings and project activity into structured, time-aware memory, detects changes, contradictions, risks, blockers, and commitments, and reasons over the entire project history to explain what changed, why it changed, what's blocked, and what should happen next.**

# 57. What We Should Build First

The implementation priority should be:

```text
Phase 1
Project + User + Meeting upload

        ↓

Phase 2
Transcription + Structured extraction

        ↓

Phase 3
Database-backed project memory

        ↓

Phase 4
Commitment + deadline tracking

        ↓

Phase 5
Meeting-to-meeting change detection

        ↓

Phase 6
Timeline + risks + blockers + contradictions

        ↓

Phase 7
RAG-based AI project chat

        ↓

Phase 8
GitHub / Slack / Notion integrations

        ↓

Phase 9
Advanced reasoning + proactive alerts
```

The team should **not start by building integrations or a complicated autonomous agent**.

First prove the core loop:

**Meeting → Structured Memory → Compare With Previous Memory → Detect Change → Explain Change.**

If that loop works reliably, the rest of the platform can be built around it.