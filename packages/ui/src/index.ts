/**
 * @supernote/ui — Public surface
 *
 * Re-exports all components, hooks, utilities, and the icon library.
 * Import CSS tokens separately: `import "@supernote/ui/tokens.css"`.
 */

// ── Utilities ────────────────────────────────────────────────────────────────
export { cn } from "./cn.js";

// ── Components ───────────────────────────────────────────────────────────────
export { Button, buttonVariants } from "./components/button/index.js";
export type { ButtonProps } from "./components/button/index.js";

export {
  Card,
  CardHeader,
  CardContent,
  CardFooter,
} from "./components/card/index.js";
export type {
  CardProps,
  CardHeaderProps,
  CardContentProps,
  CardFooterProps,
} from "./components/card/index.js";

export { Input, Textarea, Label } from "./components/input/index.js";
export type { InputProps, TextareaProps, LabelProps } from "./components/input/index.js";

export {
  Modal,
  ModalRoot,
  ModalTrigger,
  ModalBackdrop,
  ModalContainer,
  ModalDialog,
  ModalHeader,
  ModalHeading,
  ModalBody,
  ModalFooter,
  ModalCloseTrigger,
} from "./components/modal/index.js";
export type { ModalProps } from "./components/modal/index.js";

export {
  Drawer,
  DrawerRoot,
  DrawerTrigger,
  DrawerBackdrop,
  DrawerContent,
  DrawerDialog,
  DrawerHeader,
  DrawerHeading,
  DrawerBody,
  DrawerFooter,
  DrawerCloseTrigger,
} from "./components/drawer/index.js";
export type { DrawerProps } from "./components/drawer/index.js";

export { Tooltip } from "./components/tooltip/index.js";
export type { TooltipProps } from "./components/tooltip/index.js";

export { DropdownMenu } from "./components/dropdown/index.js";
export type {
  DropdownMenuProps,
  DropdownMenuItem,
  DropdownMenuSection,
} from "./components/dropdown/index.js";

export { ContextMenu, useContextMenu } from "./components/context-menu/index.js";
export type {
  ContextMenuProps,
  ContextMenuState,
  ContextMenuItemDef,
} from "./components/context-menu/index.js";

export { ToastProvider, useToast } from "./components/toast/index.js";
export type { ToastData, ToastVariant } from "./components/toast/index.js";

export { Tabs } from "./components/tabs/index.js";
export type { TabsProps, TabItem } from "./components/tabs/index.js";

export { Switch } from "./components/switch/index.js";
export type { SwitchProps } from "./components/switch/index.js";

export { Checkbox } from "./components/checkbox/index.js";
export type { CheckboxProps } from "./components/checkbox/index.js";

export { Select } from "./components/select/index.js";
export type {
  SelectProps,
  SelectOption,
  SelectOptionGroup,
} from "./components/select/index.js";

export { Combobox } from "./components/combobox/index.js";
export type {
  ComboboxProps,
  ComboboxOption,
  ComboboxOptionGroup,
} from "./components/combobox/index.js";

export { Badge, badgeVariants } from "./components/badge/index.js";
export type { BadgeProps } from "./components/badge/index.js";

export { Avatar, AvatarGroup } from "./components/avatar/index.js";
export type { AvatarProps, AvatarGroupProps } from "./components/avatar/index.js";

export { Separator } from "./components/separator/index.js";
export type { SeparatorProps } from "./components/separator/index.js";

export { Skeleton, SkeletonText, SkeletonCard } from "./components/skeleton/index.js";
export type { SkeletonProps } from "./components/skeleton/index.js";

export { EmptyState } from "./components/empty-state/index.js";
export type { EmptyStateProps, EmptyStateAction } from "./components/empty-state/index.js";

export { Kbd } from "./components/kbd/index.js";
export type { KbdProps, KbdKey } from "./components/kbd/index.js";

export {
  ThemeProvider,
  ThemeToggle,
  useAppTheme,
} from "./components/theme/index.js";
export type {
  ThemeProviderProps,
  ThemeToggleProps,
  ThemeValue,
  UseThemeReturn,
} from "./components/theme/index.js";

// ── Icons ────────────────────────────────────────────────────────────────────
export {
  IconAI,
  IconAlertCircle,
  IconAlertTriangle,
  IconArchive,
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconAttachment,
  IconAutomation,
  IconBank,
  IconBarChart,
  IconBell,
  IconBellOff,
  IconBookmark,
  IconCalendar,
  IconCalendarCheck,
  IconCalendarX,
  IconCamera,
  IconChat,
  IconCheck,
  IconCheckCircle,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconClipboard,
  IconClipboardCheck,
  IconClock,
  IconClose,
  IconCode,
  IconColumns,
  IconCopy,
  IconCreditCard,
  IconCrypto,
  IconCurrency,
  IconDashboard,
  IconDatabase,
  IconDisk,
  IconDownload,
  IconDragHandle,
  IconEdit,
  IconExternalLink,
  IconEye,
  IconEyeOff,
  IconFile,
  IconFilter,
  IconFlag,
  IconFolder,
  IconFolderOpen,
  IconGitBranch,
  IconGitCommit,
  IconGitMerge,
  IconGithub,
  IconGoal,
  IconGraph,
  IconGrid,
  IconHeart,
  IconHelp,
  IconHome,
  IconImage,
  IconInbox,
  IconInfo,
  IconKanban,
  IconKey,
  IconLayers,
  IconLibrary,
  IconLineChart,
  IconLink,
  IconLink2,
  IconLinkedIn,
  IconList,
  IconLoader,
  IconLock,
  IconMail,
  IconMap,
  IconMaximize,
  IconMenu,
  IconMessage,
  IconMic,
  IconMinimize,
  IconMinus,
  IconMonitor,
  IconMoon,
  IconMoreHorizontal,
  IconMoreVertical,
  IconMove,
  IconMusic,
  IconNote,
  IconOrganisation,
  IconPanelLeft,
  IconPanelLeftClose,
  IconPanelRight,
  IconPencil,
  IconPhone,
  IconPieChart,
  IconPlus,
  IconProcessing,
  IconProject,
  IconRedo,
  IconRefresh,
  IconRows,
  IconSave,
  IconScissors,
  IconSearch,
  IconSend,
  IconServer,
  IconSettings,
  IconShare,
  IconShield,
  IconSidebarOpen,
  IconSliders,
  IconSortAsc,
  IconSortDesc,
  IconStar,
  IconSun,
  IconTable,
  IconTag,
  IconTimeline,
  IconTimer,
  IconTrash,
  IconTrashAlt,
  IconTrendingDown,
  IconTrendingUp,
  IconTwitter,
  IconUndo,
  IconUnlink,
  IconUnlock,
  IconUpload,
  IconUser,
  IconUserCheck,
  IconUserPlus,
  IconUsers,
  IconVideo,
  IconWallet,
  IconWebsite,
  IconWorkflow,
  IconXCircle,
} from "./icons.js";

export type { IconComponent, IconProps } from "./icons.js";
