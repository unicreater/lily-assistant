---
name: code-review
trigger: /review, "review code", "code review", "review this code"
description: Thorough code review assistance
---

# Code Review

When reviewing code:

1. **Quick Assessment**:
   - What language/framework?
   - What does this code do?
   - Is this a new feature, bug fix, or refactor?

2. **Review Checklist**:

### Functionality
- [ ] Does the code do what it's supposed to?
- [ ] Are edge cases handled?
- [ ] Is error handling appropriate?

### Code Quality
- [ ] Is the code readable and well-organized?
- [ ] Are variable/function names clear?
- [ ] Is there unnecessary complexity?
- [ ] DRY - is there code duplication?

### Security
- [ ] Input validation present?
- [ ] No hardcoded secrets?
- [ ] SQL injection / XSS risks?
- [ ] Proper authentication/authorization?

### Performance
- [ ] Any obvious inefficiencies?
- [ ] N+1 query issues?
- [ ] Memory leaks possible?
- [ ] Appropriate data structures used?

### Testing
- [ ] Are there tests?
- [ ] Do tests cover edge cases?
- [ ] Are tests meaningful (not just for coverage)?

3. **Feedback Format**:

```markdown
## Code Review: [Brief Description]

### Summary
[Overall assessment - good to merge / needs changes]

### What's Good
- [Positive observation]

### Suggestions
1. **[Area]** (Priority: High/Medium/Low)
   - Issue: [Description]
   - Suggestion: [How to improve]
   - Example: [Code snippet if helpful]

### Questions
- [Any clarifying questions about the code]
```

4. **Tone Guidelines**:
   - Be constructive, not critical
   - Explain the "why" behind suggestions
   - Acknowledge good patterns
   - Differentiate between "must fix" and "nice to have"
