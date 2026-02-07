import { useState, useEffect, useCallback } from "react";

interface TemplateField {
  key: string;
  label: string;
  value: string;
  aliases: string[];
}

interface FormTemplate {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  fields: TemplateField[];
  createdAt: string;
  updatedAt: string;
}

interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  fieldCount: number;
  createdAt: string;
  updatedAt: string;
}

interface FormField {
  name: string;
  type: string;
  value: string;
  label: string;
  required: boolean;
  selector: string;
  placeholder: string;
}

async function sendNative(action: string, payload: any = {}): Promise<any> {
  return chrome.runtime.sendMessage({ type: "native", action, payload });
}

export function FormsView() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<FormTemplate | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateDesc, setNewTemplateDesc] = useState("");

  // Edit state for template details
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editIsDefault, setEditIsDefault] = useState(false);
  const [editFields, setEditFields] = useState<TemplateField[]>([]);

  // Add field form
  const [addingField, setAddingField] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldValue, setNewFieldValue] = useState("");
  const [newFieldAliases, setNewFieldAliases] = useState("");

  // Import from page
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Fill Now state
  const [fillingTemplateId, setFillingTemplateId] = useState<string | null>(null);
  const [fillToast, setFillToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [showMappingUI, setShowMappingUI] = useState(false);
  const [mappingData, setMappingData] = useState<{
    formFields: any[];
    template: FormTemplate;
    mappings: Map<string, string>;
    tabId: number;
  } | null>(null);

  // Inspect mode state
  const [inspecting, setInspecting] = useState(false);
  const [inspectMode, setInspectMode] = useState<"import" | "fill" | null>(null);
  const [pendingFillTemplate, setPendingFillTemplate] = useState<FormTemplate | null>(null);

  // Fill confirmation state (when form is detected with high confidence)
  const [fillConfirmation, setFillConfirmation] = useState<{
    template: FormTemplate;
    formSelector: string;
    matchCount: number;
    totalFields: number;
    tabId: number;
  } | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await sendNative("listFormTemplates");
      if (res?.ok) {
        setTemplates(res.templates || []);
      }
    } catch (e) {
      console.error("Failed to load templates:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // Helper function to fill form fields with template data
  const fillFormWithTemplateHelper = useCallback(async (
    template: FormTemplate,
    formFields: FormField[],
    formSelector: string | null,
    tabId: number
  ) => {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
    const extractTerms = (s: string) => normalize(s).split(" ").filter((t) => t.length > 2);

    const canFill: { field: FormField; templateField: TemplateField }[] = [];

    for (const field of formFields) {
      const fieldText = [field.name, field.label, field.placeholder].filter(Boolean).join(" ");
      const fieldNorm = normalize(fieldText);
      const fieldTerms = extractTerms(fieldText);

      const matchedTemplateField = template.fields.find((tf) => {
        for (const alias of tf.aliases) {
          const aliasNorm = normalize(alias);
          const aliasTerms = extractTerms(alias);
          if (fieldNorm.includes(aliasNorm) || aliasNorm.includes(fieldNorm)) return true;
          for (const term of aliasTerms) {
            if (fieldTerms.some((ft) => ft.includes(term) || term.includes(ft))) return true;
          }
        }
        const labelNorm = normalize(tf.label);
        const keyNorm = normalize(tf.key);
        if (fieldNorm.includes(labelNorm) || labelNorm.includes(fieldNorm)) return true;
        if (fieldNorm.includes(keyNorm) || keyNorm.includes(fieldNorm)) return true;
        return false;
      });

      if (matchedTemplateField && matchedTemplateField.value) {
        canFill.push({ field, templateField: matchedTemplateField });
      }
    }

    let filled = 0;
    for (const item of canFill) {
      try {
        const response = await chrome.tabs.sendMessage(tabId, {
          type: "fillFormField",
          selector: item.field.selector,
          value: item.templateField.value,
        });
        if (response?.ok) filled++;
      } catch (e) {
        console.error("Failed to fill field:", item.field.selector, e);
      }
    }

    setFillToast({
      message: `Filled ${filled}/${formFields.length} fields from "${template.name}"`,
      type: filled > 0 ? "success" : "info",
    });

    return filled;
  }, []);

  // Listen for inspect mode results from content script
  useEffect(() => {
    const handleMessage = async (message: any) => {
      if (message.type === "inspectResult") {
        setInspecting(false);
        const { selector, inputCount } = message;

        // Get the active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return;

        // Get fields from the selected element
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: "getFieldsFromElement",
          selector,
        });

        if (!response?.ok || !response.fields?.length) {
          setImportError("No form fields found in the selected element.");
          setInspectMode(null);
          setPendingFillTemplate(null);
          return;
        }

        if (inspectMode === "import") {
          // Import mode - create new template with extracted fields
          const genKey = (label: string): string => {
            return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
          };

          const fields: TemplateField[] = response.fields.map((field: any) => {
            const label = field.label || field.name || field.placeholder || "Unknown";
            const key = genKey(label);
            const aliasSet = new Set<string>();
            if (field.name) aliasSet.add(field.name.toLowerCase());
            if (field.label) aliasSet.add(field.label.toLowerCase());
            if (field.placeholder) aliasSet.add(field.placeholder.toLowerCase());
            aliasSet.add(key);

            return {
              key,
              label,
              value: field.value || "",
              aliases: Array.from(aliasSet),
            };
          });

          const templateName = response.title || "Imported Template";
          setSelectedTemplate({
            id: "",
            name: templateName,
            description: `Imported from ${new URL(response.pageUrl || tab.url || "").hostname}`,
            isDefault: false,
            fields: [],
            createdAt: "",
            updatedAt: "",
          });
          setEditName(templateName);
          setEditDescription(`Imported from ${new URL(response.pageUrl || tab.url || "").hostname}`);
          setEditIsDefault(false);
          setEditFields(fields);
          setEditing(true);
        } else if (inspectMode === "fill" && pendingFillTemplate) {
          // Fill mode - fill the selected form with template
          await fillFormWithTemplateHelper(pendingFillTemplate, response.fields, selector, tab.id);
        }

        setInspectMode(null);
        setPendingFillTemplate(null);
      }

      if (message.type === "inspectCancelled") {
        setInspecting(false);
        setInspectMode(null);
        setPendingFillTemplate(null);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [inspectMode, pendingFillTemplate, fillFormWithTemplateHelper]);

  const loadTemplateDetail = async (templateId: string) => {
    try {
      const res = await sendNative("getFormTemplate", { templateId });
      if (res?.ok) {
        setSelectedTemplate(res.template);
        setEditName(res.template.name);
        setEditDescription(res.template.description || "");
        setEditIsDefault(res.template.isDefault || false);
        setEditFields([...res.template.fields]);
      }
    } catch (e) {
      console.error("Failed to load template:", e);
    }
  };

  const saveTemplate = async () => {
    if (!selectedTemplate) return;
    setSaving(true);
    try {
      const updatedTemplate = {
        ...selectedTemplate,
        name: editName,
        description: editDescription,
        isDefault: editIsDefault,
        fields: editFields,
      };
      const res = await sendNative("saveFormTemplate", { template: updatedTemplate });
      if (res?.ok) {
        setEditing(false);
        setSelectedTemplate(res.template);
        loadTemplates();
      }
    } catch (e) {
      console.error("Failed to save template:", e);
    } finally {
      setSaving(false);
    }
  };

  const deleteTemplate = async (templateId: string) => {
    const confirmed = window.confirm("Delete this template? This cannot be undone.");
    if (!confirmed) return;

    try {
      const res = await sendNative("deleteFormTemplate", { templateId });
      if (res?.ok) {
        setSelectedTemplate(null);
        loadTemplates();
      }
    } catch (e) {
      console.error("Failed to delete template:", e);
    }
  };

  const createTemplate = async () => {
    if (!newTemplateName.trim()) return;

    const template: Partial<FormTemplate> = {
      name: newTemplateName.trim(),
      description: newTemplateDesc.trim(),
      fields: [],
    };

    try {
      const res = await sendNative("saveFormTemplate", { template });
      if (res?.ok) {
        setCreating(false);
        setNewTemplateName("");
        setNewTemplateDesc("");
        loadTemplates();
        loadTemplateDetail(res.template.id);
        setEditing(true);
      }
    } catch (e) {
      console.error("Failed to create template:", e);
    }
  };

  // Start inspect mode for importing
  const importFromPage = async () => {
    setImportError(null);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setImportError("No active tab found");
        return;
      }

      // Start inspect mode
      setInspecting(true);
      setInspectMode("import");
      await chrome.tabs.sendMessage(tab.id, { type: "startInspect" });
    } catch (e: any) {
      console.error("Failed to start inspect:", e);
      setImportError(e.message || "Failed to start inspect mode");
      setInspecting(false);
    } finally {
      setImporting(false);
    }
  };

  // Confirm and fill the detected form
  const confirmFill = async () => {
    if (!fillConfirmation) return;

    setFillingTemplateId(fillConfirmation.template.id);

    try {
      // Get the form fields from the detected form
      const response = await chrome.tabs.sendMessage(fillConfirmation.tabId, {
        type: "getFieldsFromElement",
        selector: fillConfirmation.formSelector,
      });

      if (response?.ok && response.fields?.length) {
        await fillFormWithTemplateHelper(
          fillConfirmation.template,
          response.fields,
          fillConfirmation.formSelector,
          fillConfirmation.tabId
        );
      } else {
        setFillToast({ message: "Could not get form fields", type: "error" });
      }

      // Remove highlight
      await chrome.tabs.sendMessage(fillConfirmation.tabId, { type: "removeHighlight" });
    } catch (e: any) {
      console.error("Failed to fill form:", e);
      setFillToast({ message: e.message || "Failed to fill form", type: "error" });
    } finally {
      setFillConfirmation(null);
      setFillingTemplateId(null);
    }
  };

  // Reject the detected form and enter inspect mode to choose another
  const rejectFillAndInspect = async () => {
    if (!fillConfirmation) return;

    try {
      // Remove current highlight
      await chrome.tabs.sendMessage(fillConfirmation.tabId, { type: "removeHighlight" });

      // Store the template for after inspect
      setPendingFillTemplate(fillConfirmation.template);
      setInspectMode("fill");
      setInspecting(true);

      // Start inspect mode
      await chrome.tabs.sendMessage(fillConfirmation.tabId, { type: "startInspect" });
    } catch (e: any) {
      console.error("Failed to start inspect:", e);
      setFillToast({ message: e.message || "Failed to start inspect mode", type: "error" });
      setInspecting(false);
      setInspectMode(null);
      setPendingFillTemplate(null);
    } finally {
      setFillConfirmation(null);
    }
  };

  // Cancel fill confirmation
  const cancelFillConfirmation = async () => {
    if (!fillConfirmation) return;

    try {
      await chrome.tabs.sendMessage(fillConfirmation.tabId, { type: "removeHighlight" });
    } catch (e) {
      console.error("Failed to remove highlight:", e);
    }
    setFillConfirmation(null);
  };

  // Fill Now - quick action to fill forms from template
  const handleFillNow = async (templateId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Don't open template detail
    setFillingTemplateId(templateId);
    setFillToast(null);

    try {
      // 1. Get active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setFillToast({ message: "No active tab found", type: "error" });
        return;
      }

      // 2. Get form fields from page
      const formsResponse = await chrome.tabs.sendMessage(tab.id, { type: "getFormFields" });
      if (!formsResponse?.ok || !formsResponse.forms?.length) {
        setFillToast({ message: "No forms found on this page", type: "error" });
        setFillingTemplateId(null);
        return;
      }

      // 3. Get full template
      const templateRes = await sendNative("getFormTemplate", { templateId });
      if (!templateRes?.ok) {
        setFillToast({ message: "Failed to load template", type: "error" });
        return;
      }
      const template: FormTemplate = templateRes.template;

      // 4. Collect all form fields and find the best form
      let bestForm = formsResponse.forms[0];
      let bestMatchCount = 0;

      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
      const extractTerms = (s: string) => normalize(s).split(" ").filter((t) => t.length > 2);

      for (const form of formsResponse.forms) {
        let matchCount = 0;
        for (const field of form.fields) {
          const fieldText = [field.name, field.label, field.placeholder].filter(Boolean).join(" ");
          const fieldNorm = normalize(fieldText);
          const fieldTerms = extractTerms(fieldText);

          const matched = template.fields.some((tf) => {
            for (const alias of tf.aliases) {
              const aliasNorm = normalize(alias);
              const aliasTerms = extractTerms(alias);
              if (fieldNorm.includes(aliasNorm) || aliasNorm.includes(fieldNorm)) return true;
              for (const term of aliasTerms) {
                if (fieldTerms.some((ft) => ft.includes(term) || term.includes(ft))) return true;
              }
            }
            const labelNorm = normalize(tf.label);
            const keyNorm = normalize(tf.key);
            if (fieldNorm.includes(labelNorm) || labelNorm.includes(fieldNorm)) return true;
            if (fieldNorm.includes(keyNorm) || keyNorm.includes(fieldNorm)) return true;
            return false;
          });

          if (matched) matchCount++;
        }

        if (matchCount > bestMatchCount) {
          bestMatchCount = matchCount;
          bestForm = form;
        }
      }

      const confidence = bestForm.fields.length > 0 ? bestMatchCount / bestForm.fields.length : 0;

      // 5. Decision based on confidence
      if (confidence >= 0.5 && bestMatchCount > 0) {
        // High probability match - highlight and show confirmation
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: "highlightElement",
            selector: bestForm.selector,
            label: `Fill with "${template.name}"?`,
          });
        } catch (e) {
          console.error("Failed to highlight form:", e);
        }

        // Show confirmation UI
        setFillConfirmation({
          template,
          formSelector: bestForm.selector,
          matchCount: bestMatchCount,
          totalFields: bestForm.fields.length,
          tabId: tab.id,
        });
        setFillingTemplateId(null);
      } else {
        // No good match - go straight to inspect mode
        setPendingFillTemplate(template);
        setInspectMode("fill");
        setInspecting(true);
        setFillingTemplateId(null);

        await chrome.tabs.sendMessage(tab.id, { type: "startInspect" });
      }
    } catch (e: any) {
      console.error("Fill Now failed:", e);
      setFillToast({ message: e.message || "Failed to fill form", type: "error" });
      setFillingTemplateId(null);
    }
  };

  // Execute mapped fill
  const executeMappedFill = async () => {
    if (!mappingData) return;
    setFillingTemplateId(mappingData.template.id);

    try {
      let filled = 0;
      for (const [selector, templateKey] of mappingData.mappings) {
        const templateField = mappingData.template.fields.find((f) => f.key === templateKey);
        if (!templateField?.value) continue;

        try {
          const response = await chrome.tabs.sendMessage(mappingData.tabId, {
            type: "fillFormField",
            selector,
            value: templateField.value,
          });
          if (response?.ok) filled++;
        } catch (e) {
          console.error("Failed to fill field:", selector, e);
        }
      }

      setFillToast({
        message: `Filled ${filled}/${mappingData.mappings.size} fields from "${mappingData.template.name}"`,
        type: "success",
      });
      setShowMappingUI(false);
      setMappingData(null);
    } catch (e: any) {
      setFillToast({ message: e.message || "Failed to fill", type: "error" });
    } finally {
      setFillingTemplateId(null);
    }
  };

  // Update field mapping
  const updateMapping = (selector: string, templateKey: string | null) => {
    if (!mappingData) return;
    const newMappings = new Map(mappingData.mappings);
    if (templateKey) {
      newMappings.set(selector, templateKey);
    } else {
      newMappings.delete(selector);
    }
    setMappingData({ ...mappingData, mappings: newMappings });
  };

  const generateFieldKey = (label: string): string => {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  };

  const addField = () => {
    if (!newFieldLabel.trim()) return;

    const key = generateFieldKey(newFieldLabel);
    const aliases = newFieldAliases
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean);

    // Add key to aliases if not present
    if (!aliases.includes(key)) {
      aliases.unshift(key);
    }

    const newField: TemplateField = {
      key,
      label: newFieldLabel.trim(),
      value: newFieldValue.trim(),
      aliases,
    };

    setEditFields([...editFields, newField]);
    setAddingField(false);
    setNewFieldLabel("");
    setNewFieldValue("");
    setNewFieldAliases("");
  };

  const updateField = (index: number, updates: Partial<TemplateField>) => {
    const newFields = [...editFields];
    newFields[index] = { ...newFields[index], ...updates };
    setEditFields(newFields);
  };

  const removeField = (index: number) => {
    const newFields = editFields.filter((_, i) => i !== index);
    setEditFields(newFields);
  };

  // Template detail view
  if (selectedTemplate) {
    return (
      <div className="flex-1 flex flex-col min-h-0 p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => {
              setSelectedTemplate(null);
              setEditing(false);
            }}
            className="text-lily-muted hover:text-lily-accent text-sm flex items-center gap-1"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              className="w-4 h-4"
            >
              <path
                fillRule="evenodd"
                d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z"
                clipRule="evenodd"
              />
            </svg>
            Back to Templates
          </button>
          <div className="flex gap-2">
            {editing ? (
              <>
                <button
                  onClick={() => {
                    setEditing(false);
                    setEditName(selectedTemplate.name);
                    setEditDescription(selectedTemplate.description || "");
                    setEditIsDefault(selectedTemplate.isDefault || false);
                    setEditFields([...selectedTemplate.fields]);
                  }}
                  className="px-3 py-1.5 rounded-lg glass-card text-lily-muted text-xs hover:text-lily-text"
                >
                  Cancel
                </button>
                <button
                  onClick={saveTemplate}
                  disabled={saving || !editName.trim()}
                  className="px-3 py-1.5 rounded-lg bg-lily-accent text-white text-xs hover:bg-lily-hover disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setEditing(true)}
                  className="px-3 py-1.5 rounded-lg glass-card text-lily-muted text-xs hover:text-lily-accent"
                >
                  Edit
                </button>
                <button
                  onClick={() => deleteTemplate(selectedTemplate.id)}
                  className="px-3 py-1.5 rounded-lg glass-card text-lily-muted text-xs hover:text-red-400"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>

        {/* Template info */}
        {editing ? (
          <div className="space-y-3 mb-4">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full glass-card text-lily-text rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lily-accent"
              placeholder="Template name"
            />
            <input
              type="text"
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="w-full glass-card text-lily-text rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lily-accent"
              placeholder="Description (optional)"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editIsDefault}
                onChange={(e) => setEditIsDefault(e.target.checked)}
                className="rounded"
              />
              <span className="text-lily-muted">Set as default template</span>
            </label>
          </div>
        ) : (
          <div className="mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              {selectedTemplate.name}
              {selectedTemplate.isDefault && (
                <span className="px-2 py-0.5 bg-lily-accent/20 text-lily-accent rounded text-xs">
                  Default
                </span>
              )}
            </h3>
            {selectedTemplate.description && (
              <p className="text-sm text-lily-muted mt-1">{selectedTemplate.description}</p>
            )}
          </div>
        )}

        {/* Fields */}
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-lily-muted">Fields ({editFields.length})</h4>
          {editing && (
            <button
              onClick={() => setAddingField(true)}
              className="px-2 py-1 text-xs text-lily-accent hover:text-lily-hover"
            >
              + Add Field
            </button>
          )}
        </div>

        {/* Add field form */}
        {editing && addingField && (
          <div className="glass-card rounded-lg p-3 mb-3 space-y-2">
            <input
              type="text"
              value={newFieldLabel}
              onChange={(e) => setNewFieldLabel(e.target.value)}
              className="w-full glass-card text-lily-text rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lily-accent"
              placeholder="Field label (e.g., 'Full Name')"
              autoFocus
            />
            <textarea
              value={newFieldValue}
              onChange={(e) => setNewFieldValue(e.target.value)}
              className="w-full glass-card text-lily-text rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lily-accent resize-y min-h-[60px]"
              placeholder="Your value (e.g., 'John Doe' or multi-line text)"
              rows={2}
            />
            <input
              type="text"
              value={newFieldAliases}
              onChange={(e) => setNewFieldAliases(e.target.value)}
              className="w-full glass-card text-lily-text rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lily-accent"
              placeholder="Aliases to match (e.g., 'name, fullname, your_name')"
            />
            <div className="flex gap-2">
              <button
                onClick={addField}
                disabled={!newFieldLabel.trim()}
                className="px-3 py-1.5 rounded-lg bg-lily-accent text-white text-xs hover:bg-lily-hover disabled:opacity-50"
              >
                Add
              </button>
              <button
                onClick={() => {
                  setAddingField(false);
                  setNewFieldLabel("");
                  setNewFieldValue("");
                  setNewFieldAliases("");
                }}
                className="px-3 py-1.5 rounded-lg glass-card text-lily-muted text-xs hover:text-lily-text"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Fields list */}
        <div className="flex-1 overflow-y-auto space-y-2">
          {editFields.length === 0 ? (
            <div className="text-sm text-lily-muted text-center py-8">
              No fields yet. Add fields to auto-fill forms.
            </div>
          ) : (
            editFields.map((field, index) => (
              <div key={field.key} className="glass-card rounded-lg p-3">
                {editing ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <input
                        type="text"
                        value={field.label}
                        onChange={(e) => updateField(index, { label: e.target.value })}
                        className="flex-1 bg-transparent text-sm font-medium outline-none focus:ring-1 focus:ring-lily-accent rounded px-2 py-1"
                        placeholder="Label"
                      />
                      <button
                        onClick={() => removeField(index)}
                        className="text-lily-muted hover:text-red-400 p-1"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 16 16"
                          fill="currentColor"
                          className="w-4 h-4"
                        >
                          <path
                            fillRule="evenodd"
                            d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5a.75.75 0 0 1 .786-.712Z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                    </div>
                    <textarea
                      value={field.value}
                      onChange={(e) => updateField(index, { value: e.target.value })}
                      className="w-full glass-card text-lily-text rounded px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-lily-accent resize-y min-h-[40px]"
                      placeholder="Value"
                      rows={field.value.includes("\n") ? Math.min(field.value.split("\n").length + 1, 6) : 1}
                    />
                    <input
                      type="text"
                      value={field.aliases.join(", ")}
                      onChange={(e) =>
                        updateField(index, {
                          aliases: e.target.value
                            .split(",")
                            .map((a) => a.trim().toLowerCase())
                            .filter(Boolean),
                        })
                      }
                      className="w-full glass-card text-lily-muted rounded px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-lily-accent"
                      placeholder="Aliases (comma-separated)"
                    />
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between">
                      <span className="text-sm font-medium">{field.label}</span>
                    </div>
                    <p className="text-sm text-lily-text mt-1 whitespace-pre-wrap">{field.value || "(empty)"}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {field.aliases.map((alias, i) => (
                        <span
                          key={i}
                          className="px-1.5 py-0.5 glass rounded text-[10px] text-lily-muted"
                        >
                          {alias}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // Templates list view
  return (
    <div className="flex-1 flex flex-col min-h-0 p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span>📝</span> Form Templates
        </h2>
        <div className="flex gap-2">
          <button
            onClick={importFromPage}
            disabled={importing}
            className="px-3 py-1.5 rounded-lg glass-card text-xs hover:ring-1 hover:ring-lily-accent disabled:opacity-50"
            title="Import fields from current page"
          >
            {importing ? "..." : "Import"}
          </button>
          <button
            onClick={() => setCreating(true)}
            className="px-3 py-1.5 rounded-lg bg-lily-accent text-white text-xs hover:bg-lily-hover"
          >
            + New
          </button>
        </div>
      </div>

      {/* Import error */}
      {importError && (
        <div className="mb-4 p-3 glass-card rounded-lg border border-red-500/30">
          <div className="flex items-center justify-between">
            <span className="text-xs text-red-400">{importError}</span>
            <button
              onClick={() => setImportError(null)}
              className="text-lily-muted hover:text-lily-text"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Inspect mode banner */}
      {inspecting && (
        <div className="mb-4 p-3 glass-card rounded-lg border border-yellow-500/30 animate-pulse">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 text-yellow-400">
              <path fillRule="evenodd" d="M9.965 11.026a5 5 0 1 1 1.06-1.06l2.755 2.754a.75.75 0 1 1-1.06 1.06l-2.755-2.754ZM10.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z" clipRule="evenodd" />
            </svg>
            <span className="text-xs text-yellow-400">
              {inspectMode === "import" ? "Click on a form to import its fields" : "Click on a form to fill it"}
            </span>
          </div>
          <p className="text-[10px] text-lily-muted mt-1 ml-6">Press Escape to cancel</p>
        </div>
      )}

      {/* Fill confirmation popup */}
      {fillConfirmation && (
        <div className="mb-4 p-4 glass-card rounded-lg border border-green-500/30">
          <div className="flex items-center gap-2 mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 text-green-400">
              <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
            </svg>
            <span className="text-sm font-medium text-green-400">Form detected!</span>
          </div>
          <p className="text-xs text-lily-muted mb-3">
            Found {fillConfirmation.matchCount}/{fillConfirmation.totalFields} matching fields.
            Fill this form with "{fillConfirmation.template.name}"?
          </p>
          <div className="flex gap-2">
            <button
              onClick={confirmFill}
              disabled={fillingTemplateId !== null}
              className="flex-1 px-3 py-2 rounded-lg bg-green-500 text-white text-xs font-medium hover:bg-green-600 disabled:opacity-50"
            >
              {fillingTemplateId ? "Filling..." : "Yes, Fill Now"}
            </button>
            <button
              onClick={rejectFillAndInspect}
              className="px-3 py-2 rounded-lg glass-card text-lily-text text-xs hover:ring-1 hover:ring-lily-accent"
            >
              Select Different
            </button>
            <button
              onClick={cancelFillConfirmation}
              className="px-3 py-2 rounded-lg glass-card text-lily-muted text-xs hover:text-lily-text"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Create new template modal */}
      {creating && (
        <div className="mb-4 p-4 glass-card rounded-lg space-y-3">
          <h3 className="text-sm font-semibold">Create New Template</h3>
          <input
            type="text"
            value={newTemplateName}
            onChange={(e) => setNewTemplateName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createTemplate()}
            placeholder="Template name (e.g., 'My Profile')"
            className="w-full glass-card text-lily-text rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lily-accent placeholder:text-lily-muted"
            autoFocus
          />
          <input
            type="text"
            value={newTemplateDesc}
            onChange={(e) => setNewTemplateDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full glass-card text-lily-text rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lily-accent placeholder:text-lily-muted"
          />
          <div className="flex gap-2">
            <button
              onClick={createTemplate}
              disabled={!newTemplateName.trim()}
              className="px-3 py-2 rounded-lg bg-lily-accent text-white hover:bg-lily-hover disabled:opacity-50"
            >
              Create
            </button>
            <button
              onClick={() => {
                setCreating(false);
                setNewTemplateName("");
                setNewTemplateDesc("");
              }}
              className="px-3 py-2 rounded-lg glass-card text-lily-muted hover:text-lily-text"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {fillToast && (
        <div
          className={`mb-4 p-3 glass-card rounded-lg border ${
            fillToast.type === "success"
              ? "border-green-500/30"
              : fillToast.type === "error"
              ? "border-red-500/30"
              : "border-blue-500/30"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {fillToast.type === "success" && (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 text-green-400">
                  <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                </svg>
              )}
              {fillToast.type === "error" && (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 text-red-400">
                  <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14ZM8 4a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                </svg>
              )}
              {fillToast.type === "info" && (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 text-blue-400">
                  <path fillRule="evenodd" d="M15 8A7 7 0 1 1 1 8a7 7 0 0 1 14 0ZM9 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM6.75 8a.75.75 0 0 0 0 1.5h.75v1.75a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8.25 8h-1.5Z" clipRule="evenodd" />
                </svg>
              )}
              <span
                className={`text-xs ${
                  fillToast.type === "success"
                    ? "text-green-400"
                    : fillToast.type === "error"
                    ? "text-red-400"
                    : "text-blue-400"
                }`}
              >
                {fillToast.message}
              </span>
            </div>
            <button onClick={() => setFillToast(null)} className="text-lily-muted hover:text-lily-text">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Field Mapping UI */}
      {showMappingUI && mappingData && (
        <div className="mb-4 p-4 glass-card rounded-lg border border-blue-500/30">
          <div className="flex items-center gap-2 mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 text-blue-400">
              <path fillRule="evenodd" d="M3.75 2a.75.75 0 0 0 0 1.5H4v9h-.25a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5H6v-9h.25a.75.75 0 0 0 0-1.5h-2.5ZM10 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 5.5a4.5 4.5 0 0 0 4.5-4.5.75.75 0 0 0-1.5 0 3 3 0 1 1-6 0 .75.75 0 0 0-1.5 0A4.5 4.5 0 0 0 10 13.5Z" clipRule="evenodd" />
            </svg>
            <span className="text-sm font-medium text-blue-400">Map Fields Manually</span>
          </div>
          <p className="text-xs text-lily-muted mb-3">
            No automatic matches found. Map form fields to your template values:
          </p>
          <div className="space-y-2 max-h-48 overflow-y-auto mb-3">
            {mappingData.formFields.map((field) => {
              const currentMapping = mappingData.mappings.get(field.selector);
              return (
                <div key={field.selector} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="text-xs truncate block">{field.label || field.name || field.placeholder || "Unknown"}</span>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-lily-muted flex-shrink-0">
                    <path fillRule="evenodd" d="M2 8a.75.75 0 0 1 .75-.75h8.69L8.22 4.03a.75.75 0 0 1 1.06-1.06l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 0 1-1.06-1.06l3.22-3.22H2.75A.75.75 0 0 1 2 8Z" clipRule="evenodd" />
                  </svg>
                  <select
                    value={currentMapping || ""}
                    onChange={(e) => updateMapping(field.selector, e.target.value || null)}
                    className={`flex-1 glass-card rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-blue-400 ${currentMapping ? "text-green-400" : "text-lily-muted"}`}
                  >
                    <option value="">Skip</option>
                    {mappingData.template.fields.map((tf) => (
                      <option key={tf.key} value={tf.key}>
                        {tf.label}: {tf.value ? `"${tf.value.slice(0, 15)}${tf.value.length > 15 ? "..." : ""}"` : "(empty)"}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <button
              onClick={executeMappedFill}
              disabled={fillingTemplateId !== null || mappingData.mappings.size === 0}
              className="flex-1 px-3 py-2 rounded-lg bg-blue-500 text-white text-xs hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {fillingTemplateId ? "Filling..." : `Fill ${mappingData.mappings.size} Field${mappingData.mappings.size !== 1 ? "s" : ""}`}
            </button>
            <button
              onClick={() => {
                setShowMappingUI(false);
                setMappingData(null);
              }}
              className="px-3 py-2 rounded-lg glass-card text-lily-muted text-xs hover:text-lily-text"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Info */}
      <p className="text-xs text-lily-muted mb-4">
        Create templates with your info, then click <strong>Fill Now</strong> to auto-fill forms on any page.
      </p>

      {/* Templates list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-sm text-lily-muted text-center py-8">Loading...</div>
        ) : templates.length === 0 ? (
          <div className="text-sm text-lily-muted text-center py-8">
            No templates yet. Create one to get started with auto-fill.
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map((template) => (
              <div
                key={template.id}
                className="glass-card rounded-lg p-3 hover:ring-1 hover:ring-lily-accent transition-all"
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    onClick={() => loadTemplateDetail(template.id)}
                    className="flex-1 text-left min-w-0"
                  >
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      {template.name}
                      {template.isDefault && (
                        <span className="px-1.5 py-0.5 bg-lily-accent/20 text-lily-accent rounded text-[10px]">
                          Default
                        </span>
                      )}
                    </h3>
                    {template.description && (
                      <p className="text-xs text-lily-muted mt-0.5 truncate">{template.description}</p>
                    )}
                    <span className="text-[10px] text-lily-muted mt-1 block">{template.fieldCount} fields</span>
                  </button>
                  <button
                    onClick={(e) => handleFillNow(template.id, e)}
                    disabled={fillingTemplateId === template.id}
                    className="px-3 py-1.5 rounded-lg bg-green-500/20 text-green-400 text-xs font-medium hover:bg-green-500/30 disabled:opacity-50 flex-shrink-0 transition-colors"
                  >
                    {fillingTemplateId === template.id ? (
                      <span className="flex items-center gap-1">
                        <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Filling
                      </span>
                    ) : (
                      "Fill Now"
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-xs text-lily-muted mt-4 text-center">
        Templates stored in ~/lily/forms/
      </div>
    </div>
  );
}
