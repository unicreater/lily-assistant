import { useState } from "react";

interface Props {
  onComplete: () => void;
}

interface OnboardingAnswers {
  primaryUse: string[];
  workContext: string;
  communicationStyle: string;
  goals: string;
  name: string;
}

const QUESTIONS = [
  {
    id: "name",
    title: "Let's personalize Lily",
    question: "What should Lily call you?",
    type: "text",
    placeholder: "Your name or nickname",
  },
  {
    id: "primaryUse",
    title: "What brings you here?",
    question: "What do you primarily want help with?",
    type: "multiselect",
    options: [
      { id: "research", label: "Research & Learning", icon: "🔍" },
      { id: "work", label: "Work Tasks", icon: "💼" },
      { id: "coding", label: "Coding & Technical", icon: "💻" },
      { id: "writing", label: "Writing & Content", icon: "✍️" },
      { id: "planning", label: "Planning & Organization", icon: "📋" },
      { id: "personal", label: "Personal Assistant", icon: "🏠" },
    ],
  },
  {
    id: "workContext",
    title: "Your context",
    question: "What industry or domain do you work in?",
    type: "text",
    placeholder: "e.g., Finance, Tech, Healthcare, Student...",
  },
  {
    id: "communicationStyle",
    title: "Communication style",
    question: "How should Lily communicate with you?",
    type: "select",
    options: [
      { id: "concise", label: "Concise & Direct", desc: "Short, to-the-point answers" },
      { id: "detailed", label: "Detailed & Thorough", desc: "Comprehensive explanations" },
      { id: "casual", label: "Casual & Friendly", desc: "Relaxed, conversational tone" },
      { id: "professional", label: "Professional", desc: "Formal, business-appropriate" },
    ],
  },
  {
    id: "goals",
    title: "Your goals",
    question: "Any specific goals you're working towards?",
    type: "textarea",
    placeholder: "e.g., Learn a new skill, finish a project, stay organized...",
  },
];

async function sendNative(action: string, payload: any = {}): Promise<any> {
  return chrome.runtime.sendMessage({ type: "native", action, payload });
}

function generateClaudeMd(answers: OnboardingAnswers): string {
  const name = answers.name || "User";

  const styleMap: Record<string, string> = {
    concise: `- Be concise and direct - no fluff, no filler
- Lead with the answer, then explain if needed
- Use bullet points for clarity
- Skip pleasantries like "Great question!" or "I'd be happy to help"`,
    detailed: `- Provide thorough, comprehensive answers
- Include context, examples, and explanations
- Break down complex topics step by step
- Anticipate follow-up questions`,
    casual: `- Be friendly and conversational
- Use a relaxed tone like chatting with a knowledgeable friend
- It's okay to use humor when appropriate
- Keep things light but still helpful`,
    professional: `- Maintain a professional, business-appropriate tone
- Be polished, precise, and well-structured
- Use formal language suitable for work contexts
- Focus on actionable insights`,
  };

  const focusAreas: string[] = [];
  if (answers.primaryUse.includes("research")) {
    focusAreas.push("- **Research**: Search the web proactively. Don't ask \"would you like me to search?\" - just search and provide findings");
  }
  if (answers.primaryUse.includes("work")) {
    focusAreas.push("- **Work**: Help with emails, documents, meeting prep, and professional challenges");
  }
  if (answers.primaryUse.includes("coding")) {
    focusAreas.push("- **Coding**: Debug issues, explain code, suggest improvements, help with technical problems");
  }
  if (answers.primaryUse.includes("writing")) {
    focusAreas.push("- **Writing**: Draft, edit, and improve content. Match tone and style to the context");
  }
  if (answers.primaryUse.includes("planning")) {
    focusAreas.push("- **Planning**: Help organize tasks, break down projects, track progress toward goals");
  }
  if (answers.primaryUse.includes("personal")) {
    focusAreas.push("- **Personal**: Assist with life admin, reminders, recommendations, and daily tasks");
  }

  return `# Lily - Personal Assistant for ${name}

You are Lily, a personal AI assistant living in ${name}'s browser sidebar. You have access to powerful tools and should use them proactively to help ${name}.

## About ${name}
${answers.workContext ? `- Works in: **${answers.workContext}**` : ""}
${answers.goals ? `- Current goals: ${answers.goals}` : ""}

## Communication Style
${styleMap[answers.communicationStyle] || styleMap.concise}

## Focus Areas
${focusAreas.length > 0 ? focusAreas.join("\n") : "- Be a helpful general-purpose assistant"}

---

## Core Behaviors

### 1. BE PROACTIVE - Don't Ask, Just Do

**Web Search** - USE LIBERALLY:
- Current events, news, weather → Search immediately
- Prices, availability, comparisons → Search immediately
- Facts you're unsure about → Search to verify
- "What's the latest on X?" → Search immediately
- NEVER say "I can search for that if you'd like" - just do it

**Tool Usage**:
- If a task needs a tool, use it without asking permission
- If ${name} says "yes" or gives short affirmation, execute what was proposed
- Chain multiple tools together to complete complex tasks

### 2. REMEMBER CONTEXT

- Track the full conversation flow
- Reference earlier parts of the conversation when relevant
- If ${name} refers to "it" or "that", look back to understand the reference
- Build on previous answers rather than starting fresh each time

### 3. TAKE ACTION

When ${name} asks you to do something:
1. Do it (don't just explain how)
2. Show the result
3. Offer next steps if relevant

Examples:
- "Search for X" → Search and summarize findings
- "Write an email about Y" → Write the full email, ready to send
- "Help me plan Z" → Create an actual plan with steps and timeline

### 4. BE GENUINELY HELPFUL

- Anticipate what ${name} might need next
- Offer relevant suggestions without being pushy
- If something seems off or could be improved, mention it
- Remember ${name}'s preferences and context${answers.goals ? `\n- Keep ${name}'s goals in mind: ${answers.goals}` : ""}

---

## Available Tools

| Tool | Use For |
|------|---------|
| **WebSearch** | Current info, facts, news, prices, research (USE OFTEN) |
| **WebFetch** | Reading specific web pages, articles, documentation |
| **Read** | Reading files from the local system |
| **Write** | Creating new files |
| **Edit** | Modifying existing files |
| **Bash** | Running terminal commands, scripts |

---

## Important Reminders

1. **Search first, apologize never** - If you need current info, search. Don't say "I don't have access to real-time data"
2. **Action over explanation** - Do the thing, don't just describe how to do it
3. **${name}'s time is valuable** - Be efficient, be accurate, be helpful
4. **When in doubt, ask** - But only for genuine ambiguity, not for permission to use tools

You're not just an AI - you're ${name}'s capable assistant. Act like it.
`;
}

export function OnboardingFlow({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<OnboardingAnswers>({
    primaryUse: [],
    workContext: "",
    communicationStyle: "concise",
    goals: "",
    name: "",
  });
  const [saving, setSaving] = useState(false);

  const currentQuestion = QUESTIONS[step];
  const isLastStep = step === QUESTIONS.length - 1;

  const handleNext = async () => {
    if (isLastStep) {
      // Generate and save CLAUDE.md
      setSaving(true);
      try {
        const claudeMd = generateClaudeMd(answers);
        await sendNative("saveClaudeMd", { content: claudeMd });

        // Also save goals if provided
        if (answers.goals) {
          const goalLines = answers.goals.split("\n").filter(l => l.trim());
          await sendNative("setGoals", { goals: goalLines });
        }

        onComplete();
      } catch (e) {
        console.error("Failed to save:", e);
        setSaving(false);
      }
    } else {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const updateAnswer = (value: any) => {
    setAnswers({ ...answers, [currentQuestion.id]: value });
  };

  const toggleMultiSelect = (optionId: string) => {
    const current = answers.primaryUse;
    if (current.includes(optionId)) {
      updateAnswer(current.filter(id => id !== optionId));
    } else {
      updateAnswer([...current, optionId]);
    }
  };

  return (
    <div className="flex-1 flex flex-col p-6">
      {/* Progress */}
      <div className="flex gap-1 mb-6">
        {QUESTIONS.map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded ${
              i <= step ? "bg-lily-accent" : "bg-lily-border"
            }`}
          />
        ))}
      </div>

      {/* Question */}
      <h2 className="text-lg font-semibold text-lily-text mb-2">
        {currentQuestion.title}
      </h2>
      <p className="text-sm text-lily-muted mb-6">{currentQuestion.question}</p>

      {/* Input based on type */}
      {currentQuestion.type === "text" && (
        <input
          type="text"
          value={(answers as any)[currentQuestion.id] || ""}
          onChange={(e) => updateAnswer(e.target.value)}
          placeholder={currentQuestion.placeholder}
          className="glass-card text-lily-text rounded-lg px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-lily-accent placeholder:text-lily-muted"
          autoFocus
        />
      )}

      {currentQuestion.type === "textarea" && (
        <textarea
          value={(answers as any)[currentQuestion.id] || ""}
          onChange={(e) => updateAnswer(e.target.value)}
          placeholder={currentQuestion.placeholder}
          rows={4}
          className="glass-card text-lily-text rounded-lg px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-lily-accent placeholder:text-lily-muted resize-none"
          autoFocus
        />
      )}

      {currentQuestion.type === "multiselect" && (
        <div className="grid grid-cols-2 gap-2">
          {currentQuestion.options?.map((opt) => (
            <button
              key={opt.id}
              onClick={() => toggleMultiSelect(opt.id)}
              className={`p-3 rounded-lg text-left transition-colors ${
                answers.primaryUse.includes(opt.id)
                  ? "bg-lily-accent/20 border border-lily-accent"
                  : "glass-card hover:bg-lily-accent/10"
              }`}
            >
              <span className="text-lg">{opt.icon}</span>
              <p className="text-sm text-lily-text mt-1">{opt.label}</p>
            </button>
          ))}
        </div>
      )}

      {currentQuestion.type === "select" && (
        <div className="space-y-2">
          {currentQuestion.options?.map((opt) => (
            <button
              key={opt.id}
              onClick={() => updateAnswer(opt.id)}
              className={`w-full p-3 rounded-lg text-left transition-colors ${
                answers.communicationStyle === opt.id
                  ? "bg-lily-accent/20 border border-lily-accent"
                  : "glass-card hover:bg-lily-accent/10"
              }`}
            >
              <p className="text-sm font-medium text-lily-text">{opt.label}</p>
              <p className="text-xs text-lily-muted">{opt.desc}</p>
            </button>
          ))}
        </div>
      )}

      {/* Navigation */}
      <div className="flex gap-3 mt-auto pt-6">
        {step > 0 && (
          <button
            onClick={handleBack}
            className="px-4 py-2 rounded-lg glass-card text-lily-muted text-sm hover:text-lily-text transition-colors"
          >
            Back
          </button>
        )}
        <button
          onClick={handleNext}
          disabled={saving}
          className="flex-1 px-4 py-2 rounded-lg bg-lily-accent text-white text-sm font-medium hover:bg-lily-hover disabled:opacity-50 transition-colors"
        >
          {saving ? "Setting up..." : isLastStep ? "Complete Setup" : "Next"}
        </button>
      </div>

      {/* Skip option */}
      {step === 0 && (
        <button
          onClick={onComplete}
          className="text-xs text-lily-muted hover:text-lily-text mt-4 text-center"
        >
          Skip personalization
        </button>
      )}
    </div>
  );
}
