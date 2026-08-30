// Re-exports every lucide-react icon used across the app under its original
// name, so a call site imports from one place and its JSX (<X size={14} />)
// stays identical. The wrapper exists for one reason: lucide's own <Icon>
// does not destructure `fill`, so it flows through the spread and clobbers
// lucide's default fill="none" — and a `fill={undefined}` makes React omit
// the attribute, which an SVG reads as literal black rather than
// currentColor. So `fill` is passed on only when a caller actually set it.
import React from 'react';
import {
  AlertCircle as LuAlertCircle,
  AtSign as LuAtSign,
  Flag as LuFlag,
  AlertTriangle as LuAlertTriangle,
  ArrowDown as LuArrowDown,
  ArrowLeft as LuArrowLeft,
  ArrowRight as LuArrowRight,
  ArrowUp as LuArrowUp,
  ArrowUpDown as LuArrowUpDown,
  Ban as LuBan,
  Bold as LuBold,
  BookOpen as LuBookOpen,
  Briefcase as LuBriefcase,
  Calendar as LuCalendar,
  Camera as LuCamera,
  CalendarCheck as LuCalendarCheck,
  CalendarClock as LuCalendarClock,
  Check as LuCheck,
  CheckCircle as LuCheckCircle,
  CheckCircle2 as LuCheckCircle2,
  CheckSquare as LuCheckSquare,
  ChevronDown as LuChevronDown,
  ChevronLeft as LuChevronLeft,
  ChevronRight as LuChevronRight,
  ChevronUp as LuChevronUp,
  ChevronsLeft as LuChevronsLeft,
  ChevronsRight as LuChevronsRight,
  Clock as LuClock,
  Code as LuCode,
  Columns as LuColumns,
  ClipboardPaste as LuClipboardPaste,
  GripVertical as LuGripVertical,
  Copy as LuCopy,
  Scissors as LuScissors,
  CornerDownLeft as LuCornerDownLeft,
  Crown as LuCrown,
  Database as LuDatabase,
  Download as LuDownload,
  Edit3 as LuEdit3,
  ExternalLink as LuExternalLink,
  Eye as LuEye,
  File as LuFile,
  FileArchive as LuFileArchive,
  FileCode as LuFileCode,
  FileImage as LuFileImage,
  FilePlus as LuFilePlus,
  FileText as LuFileText,
  Film as LuFilm,
  Filter as LuFilter,
  Folder as LuFolder,
  FolderOpen as LuFolderOpen,
  FolderArchive as LuFolderArchive,
  FolderInput as LuFolderInput,
  FolderPlus as LuFolderPlus,
  Globe as LuGlobe,
  Grid as LuGrid,
  HardDrive as LuHardDrive,
  Heading1 as LuHeading1,
  Heading2 as LuHeading2,
  Heading3 as LuHeading3,
  HelpCircle as LuHelpCircle,
  Home as LuHome,
  Image as LuImage,
  Info as LuInfo,
  Italic as LuItalic,
  KeyRound as LuKeyRound,
  Layers as LuLayers,
  Link as LuLink,
  List as LuList,
  ListOrdered as LuListOrdered,
  Loader2 as LuLoader2,
  Lock as LuLock,
  LogIn as LuLogIn,
  LogOut as LuLogOut,
  Mail as LuMail,
  MessageSquare as LuMessageSquare,
  Maximize2 as LuMaximize2,
  Minimize2 as LuMinimize2,
  Minus as LuMinus,
  Monitor as LuMonitor,
  Moon as LuMoon,
  MoreHorizontal as LuMoreHorizontal,
  MoreVertical as LuMoreVertical,
  Music as LuMusic,
  Palette as LuPalette,
  Paperclip as LuPaperclip,
  Play as LuPlay,
  Plus as LuPlus,
  Quote as LuQuote,
  RefreshCw as LuRefreshCw,
  Replace as LuReplace,
  RotateCcw as LuRotateCcw,
  RotateCw as LuRotateCw,
  Save as LuSave,
  Search as LuSearch,
  Send as LuSend,
  Settings as LuSettings,
  Shield as LuShield,
  ShieldAlert as LuShieldAlert,
  ShieldCheck as LuShieldCheck,
  SlidersHorizontal as LuSlidersHorizontal,
  Sparkles as LuSparkles,
  Square as LuSquare,
  Star as LuStar,
  Strikethrough as LuStrikethrough,
  Sun as LuSun,
  Table as LuTable,
  Terminal as LuTerminal,
  Trash2 as LuTrash2,
  UploadCloud as LuUploadCloud,
  User as LuUser,
  UserCheck as LuUserCheck,
  UserPlus as LuUserPlus,
  UserX as LuUserX,
  Users as LuUsers,
  Video as LuVideo,
  Volume2 as LuVolume2,
  X as LuX,
  XCircle as LuXCircle,
  ZoomIn as LuZoomIn,
  ZoomOut as LuZoomOut,
} from 'lucide-react';

function makeIcon(Lucide) {
  return function Icon({ size = 16, color, fill, style, ...rest }) {
    const props = { size, color, style, ...rest };
    if (fill !== undefined) props.fill = fill;
    return <Lucide {...props} />;
  };
}

export const AlertCircle = makeIcon(LuAlertCircle);
export const AlertTriangle = makeIcon(LuAlertTriangle);
export const ArrowDown = makeIcon(LuArrowDown);
export const ArrowLeft = makeIcon(LuArrowLeft);
export const ArrowRight = makeIcon(LuArrowRight);
export const ArrowUp = makeIcon(LuArrowUp);
export const ArrowUpDown = makeIcon(LuArrowUpDown);
export const AtSign = makeIcon(LuAtSign);
export const Flag = makeIcon(LuFlag);
export const Ban = makeIcon(LuBan);
export const Bold = makeIcon(LuBold);
export const BookOpen = makeIcon(LuBookOpen);
export const Briefcase = makeIcon(LuBriefcase);
export const Calendar = makeIcon(LuCalendar);
export const Camera = makeIcon(LuCamera);
export const CalendarCheck = makeIcon(LuCalendarCheck);
export const CalendarClock = makeIcon(LuCalendarClock);
export const Check = makeIcon(LuCheck);
export const CheckCircle = makeIcon(LuCheckCircle);
export const CheckCircle2 = makeIcon(LuCheckCircle2);
export const CheckSquare = makeIcon(LuCheckSquare);
export const ChevronDown = makeIcon(LuChevronDown);
export const ChevronLeft = makeIcon(LuChevronLeft);
export const ChevronRight = makeIcon(LuChevronRight);
export const ChevronUp = makeIcon(LuChevronUp);
export const ChevronsLeft = makeIcon(LuChevronsLeft);
export const ChevronsRight = makeIcon(LuChevronsRight);
export const Clock = makeIcon(LuClock);
export const Code = makeIcon(LuCode);
export const Columns = makeIcon(LuColumns);
export const ClipboardPaste = makeIcon(LuClipboardPaste);
export const GripVertical = makeIcon(LuGripVertical);
export const Copy = makeIcon(LuCopy);
export const Scissors = makeIcon(LuScissors);
export const CornerDownLeft = makeIcon(LuCornerDownLeft);
export const Crown = makeIcon(LuCrown);
export const Database = makeIcon(LuDatabase);
export const Download = makeIcon(LuDownload);
export const Edit3 = makeIcon(LuEdit3);
export const ExternalLink = makeIcon(LuExternalLink);
export const Eye = makeIcon(LuEye);
export const File = makeIcon(LuFile);
export const FileArchive = makeIcon(LuFileArchive);
export const FileCode = makeIcon(LuFileCode);
export const FileImage = makeIcon(LuFileImage);
export const FilePlus = makeIcon(LuFilePlus);
export const FileText = makeIcon(LuFileText);
export const Film = makeIcon(LuFilm);
export const Filter = makeIcon(LuFilter);
export const Folder = makeIcon(LuFolder);
export const FolderOpen = makeIcon(LuFolderOpen);
export const FolderArchive = makeIcon(LuFolderArchive);
export const FolderInput = makeIcon(LuFolderInput);
export const FolderPlus = makeIcon(LuFolderPlus);
export const Globe = makeIcon(LuGlobe);
export const Grid = makeIcon(LuGrid);
export const HardDrive = makeIcon(LuHardDrive);
export const Heading1 = makeIcon(LuHeading1);
export const Heading2 = makeIcon(LuHeading2);
export const Heading3 = makeIcon(LuHeading3);
export const HelpCircle = makeIcon(LuHelpCircle);
export const Home = makeIcon(LuHome);
export const Image = makeIcon(LuImage);
export const Info = makeIcon(LuInfo);
export const Italic = makeIcon(LuItalic);
export const KeyRound = makeIcon(LuKeyRound);
export const Layers = makeIcon(LuLayers);
export const Link = makeIcon(LuLink);
export const List = makeIcon(LuList);
export const ListOrdered = makeIcon(LuListOrdered);
export const Loader2 = makeIcon(LuLoader2);
export const Lock = makeIcon(LuLock);
export const LogIn = makeIcon(LuLogIn);
export const LogOut = makeIcon(LuLogOut);
export const Mail = makeIcon(LuMail);
export const MessageSquare = makeIcon(LuMessageSquare);
export const Maximize2 = makeIcon(LuMaximize2);
export const Minimize2 = makeIcon(LuMinimize2);
export const Minus = makeIcon(LuMinus);
export const Monitor = makeIcon(LuMonitor);
export const Moon = makeIcon(LuMoon);
export const MoreHorizontal = makeIcon(LuMoreHorizontal);
export const MoreVertical = makeIcon(LuMoreVertical);
export const Music = makeIcon(LuMusic);
export const Palette = makeIcon(LuPalette);
export const Paperclip = makeIcon(LuPaperclip);
export const Play = makeIcon(LuPlay);
export const Plus = makeIcon(LuPlus);
export const Quote = makeIcon(LuQuote);
export const RefreshCw = makeIcon(LuRefreshCw);
export const Replace = makeIcon(LuReplace);
export const RotateCcw = makeIcon(LuRotateCcw);
export const RotateCw = makeIcon(LuRotateCw);
export const Save = makeIcon(LuSave);
export const Search = makeIcon(LuSearch);
export const Send = makeIcon(LuSend);
export const Settings = makeIcon(LuSettings);
export const Shield = makeIcon(LuShield);
export const ShieldAlert = makeIcon(LuShieldAlert);
export const ShieldCheck = makeIcon(LuShieldCheck);
export const SlidersHorizontal = makeIcon(LuSlidersHorizontal);
export const Sparkles = makeIcon(LuSparkles);
export const Square = makeIcon(LuSquare);
export const Star = makeIcon(LuStar);
export const Strikethrough = makeIcon(LuStrikethrough);
export const Sun = makeIcon(LuSun);
export const Table = makeIcon(LuTable);
export const Terminal = makeIcon(LuTerminal);
export const Trash2 = makeIcon(LuTrash2);
export const UploadCloud = makeIcon(LuUploadCloud);
export const User = makeIcon(LuUser);
export const UserCheck = makeIcon(LuUserCheck);
export const UserPlus = makeIcon(LuUserPlus);
export const UserX = makeIcon(LuUserX);
export const Users = makeIcon(LuUsers);
export const Video = makeIcon(LuVideo);
export const Volume2 = makeIcon(LuVolume2);
// Named "X" for the close-button use case, matching lucide's own icon name —
// not the letter X.
export const X = makeIcon(LuX);
export const XCircle = makeIcon(LuXCircle);
export const ZoomIn = makeIcon(LuZoomIn);
export const ZoomOut = makeIcon(LuZoomOut);
