import { useState, useMemo, useCallback } from "react";

export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  handler: (args: string) => void | Promise<void>;
}

interface UseSlashCommandsOptions {
  commands: SlashCommand[];
  onExecute?: (command: SlashCommand, args: string) => void;
}

export function useSlashCommands({ commands, onExecute }: UseSlashCommandsOptions) {
  const [showMenu, setShowMenu] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filter, setFilter] = useState("");

  // Filter commands based on current input
  const filteredCommands = useMemo(() => {
    if (!filter) return commands;
    const lower = filter.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(lower) ||
        cmd.aliases?.some((a) => a.toLowerCase().includes(lower))
    );
  }, [commands, filter]);

  // Reset selection when filter changes
  const updateFilter = useCallback((value: string) => {
    setFilter(value);
    setSelectedIndex(0);
  }, []);

  // Check if input starts with /
  const handleInputChange = useCallback(
    (value: string) => {
      if (value.startsWith("/")) {
        setShowMenu(true);
        // Extract command filter (everything after / until space)
        const spaceIdx = value.indexOf(" ");
        const cmdPart = spaceIdx >= 0 ? value.slice(1, spaceIdx) : value.slice(1);
        updateFilter(cmdPart);
      } else {
        setShowMenu(false);
        setFilter("");
      }
    },
    [updateFilter]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, input: string): boolean => {
      if (!showMenu || filteredCommands.length === 0) return false;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredCommands.length - 1 ? prev + 1 : 0
          );
          return true;

        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : filteredCommands.length - 1
          );
          return true;

        case "Tab":
        case "Enter":
          e.preventDefault();
          const selected = filteredCommands[selectedIndex];
          if (selected) {
            executeCommand(selected, input);
          }
          return true;

        case "Escape":
          e.preventDefault();
          setShowMenu(false);
          return true;
      }
      return false;
    },
    [showMenu, filteredCommands, selectedIndex]
  );

  // Execute a command
  const executeCommand = useCallback(
    (cmd: SlashCommand, fullInput: string) => {
      setShowMenu(false);
      setFilter("");

      // Extract args (everything after command name)
      const spaceIdx = fullInput.indexOf(" ");
      const args = spaceIdx >= 0 ? fullInput.slice(spaceIdx + 1).trim() : "";

      if (onExecute) {
        onExecute(cmd, args);
      }
      cmd.handler(args);
    },
    [onExecute]
  );

  // Select a command from menu click
  const selectCommand = useCallback(
    (index: number, input: string) => {
      const cmd = filteredCommands[index];
      if (cmd) {
        executeCommand(cmd, input);
      }
    },
    [filteredCommands, executeCommand]
  );

  // Parse input to check if it's a valid command
  const parseCommand = useCallback(
    (input: string): { command: SlashCommand; args: string } | null => {
      if (!input.startsWith("/")) return null;

      const spaceIdx = input.indexOf(" ");
      const cmdName = (spaceIdx >= 0 ? input.slice(1, spaceIdx) : input.slice(1)).toLowerCase();
      const args = spaceIdx >= 0 ? input.slice(spaceIdx + 1).trim() : "";

      const cmd = commands.find(
        (c) =>
          c.name.toLowerCase() === cmdName ||
          c.aliases?.some((a) => a.toLowerCase() === cmdName)
      );

      return cmd ? { command: cmd, args } : null;
    },
    [commands]
  );

  return {
    showMenu,
    setShowMenu,
    selectedIndex,
    filteredCommands,
    handleInputChange,
    handleKeyDown,
    selectCommand,
    parseCommand,
  };
}
