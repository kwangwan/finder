// Re-exports every lucide-react icon used across the app under its original name, so
// existing `import { X } from 'lucide-react'` call sites only need their import source
// changed (JSX usage like <X size={14} color="..." /> stays identical). When the matrix
// theme is active AND a pixel-art equivalent exists, renders that instead — otherwise
// (including every non-matrix theme) falls back to the original lucide icon.
import React from 'react';
import {
  AlertCircle as LuAlertCircle,
  AtSign as LuAtSign,
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
  Maximize2 as LuMaximize2,
  Minimize2 as LuMinimize2,
  Minus as LuMinus,
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
import {
  Archive as PxArchive,
  ArrowDown as PxArrowDown,
  ArrowLeft as PxArrowLeft,
  ArrowRight as PxArrowRight,
  ArrowUp as PxArrowUp,
  Attachment as PxAttachment,
  BookOpen as PxBookOpen,
  Briefcase as PxBriefcase,
  Bulletlist as PxBulletlist,
  Calendar as PxCalendar,
  Cancel as PxCancel,
  Check as PxCheck,
  CheckboxOn as PxCheckboxOn,
  ChevronDown as PxChevronDown,
  ChevronLeft as PxChevronLeft,
  ChevronRight as PxChevronRight,
  ChevronUp as PxChevronUp,
  CircleInfo as PxCircleInfo,
  CircleQuestion as PxCircleQuestion,
  Clock as PxClock,
  Code as PxCode,
  Collapse as PxCollapse,
  ColorsSwatch as PxColorsSwatch,
  Clipboard as PxClipboard,
  Menu as PxMenu,
  Copy as PxCopy,
  Scissors as PxScissors,
  CornerDownLeft as PxCornerDownLeft,
  Crown as PxCrown,
  Database as PxDatabase,
  Download as PxDownload,
  Expand as PxExpand,
  ExternalLink as PxExternalLink,
  Eye as PxEye,
  File as PxFile,
  FileText as PxFileText,
  Filter as PxFilter,
  Folder as PxFolder,
  FolderPlus as PxFolderPlus,
  Globe as PxGlobe,
  Grid3x3 as PxGrid3x3,
  Heading1 as PxHeading1,
  Heading2 as PxHeading2,
  Heading3 as PxHeading3,
  Home as PxHome,
  Image as PxImage,
  Key as PxKey,
  Link as PxLink,
  Loader as PxLoader,
  Lock as PxLock,
  Login as PxLogin,
  Logout as PxLogout,
  Mail as PxMail,
  Minus as PxMinus,
  Moon as PxMoon,
  MoreHorizontal as PxMoreHorizontal,
  MoreVertical as PxMoreVertical,
  Move as PxMove,
  Music as PxMusic,
  Pencil as PxPencil,
  Play as PxPlay,
  Plus as PxPlus,
  QuoteTextInline as PxQuoteTextInline,
  Refresh as PxRefresh,
  Save as PxSave,
  Search as PxSearch,
  Send as PxSend,
  Server as PxServer,
  SettingsCog as PxSettingsCog,
  Shield as PxShield,
  SlidersHorizontal as PxSlidersHorizontal,
  SortVertical as PxSortVertical,
  Sparkles as PxSparkles,
  Square as PxSquare,
  SquareAlert as PxSquareAlert,
  SquareChevronLeft as PxSquareChevronLeft,
  SquareChevronRight as PxSquareChevronRight,
  Star as PxStar,
  Sun as PxSun,
  Terminal as PxTerminal,
  Trash as PxTrash,
  Upload as PxUpload,
  User as PxUser,
  UserPlus as PxUserPlus,
  UserX as PxUserX,
  Users as PxUsers,
  Video as PxVideo,
  Volume2 as PxVolume2,
  WarningDiamond as PxWarningDiamond,
  Close as PxClose,
  ZoomIn as PxZoomIn,
  ZoomOut as PxZoomOut,
} from 'pixelarticons/react';
import { useTheme } from '../context/ThemeContext';

function makeIcon(Lucide, Pixel) {
  return function ThemedIcon({ size = 16, color, fill, style, ...rest }) {
    const theme = useTheme();
    if (theme === 'matrix' && Pixel) {
      // Pixel icons are a single solid currentColor shape — no stroke/hollow
      // variant, so a lucide fill="none" (outline state) just falls back to
      // the plain color instead of trying to render hollow.
      const pixelColor = (fill && fill !== 'none') ? fill : color;
      return <Pixel width={size} height={size} style={{ color: pixelColor, ...style }} {...rest} />;
    }
    // Lucide's own <Icon> doesn't destructure `fill` separately — it flows
    // through its `...rest` spread and clobbers Lucide's default fill:"none".
    // Passing fill={undefined} here would make React omit the attribute
    // entirely, and an SVG with no `fill` attribute at all defaults to literal
    // black (not currentColor) — so only pass it through when actually set.
    const lucideProps = { size, color, style, ...rest };
    if (fill !== undefined) lucideProps.fill = fill;
    return <Lucide {...lucideProps} />;
  };
}

export const AlertCircle = makeIcon(LuAlertCircle, PxSquareAlert);
export const AlertTriangle = makeIcon(LuAlertTriangle, PxWarningDiamond);
export const ArrowDown = makeIcon(LuArrowDown, PxArrowDown);
export const ArrowLeft = makeIcon(LuArrowLeft, PxArrowLeft);
export const ArrowRight = makeIcon(LuArrowRight, PxArrowRight);
export const ArrowUp = makeIcon(LuArrowUp, PxArrowUp);
export const ArrowUpDown = makeIcon(LuArrowUpDown, PxSortVertical);
export const AtSign = makeIcon(LuAtSign, null);
export const Ban = makeIcon(LuBan, PxCancel);
export const Bold = makeIcon(LuBold, null);
export const BookOpen = makeIcon(LuBookOpen, PxBookOpen);
export const Briefcase = makeIcon(LuBriefcase, PxBriefcase);
export const Calendar = makeIcon(LuCalendar, PxCalendar);
export const Check = makeIcon(LuCheck, PxCheck);
export const CheckCircle = makeIcon(LuCheckCircle, PxCheck);
export const CheckCircle2 = makeIcon(LuCheckCircle2, PxCheck);
export const CheckSquare = makeIcon(LuCheckSquare, PxCheckboxOn);
export const ChevronDown = makeIcon(LuChevronDown, PxChevronDown);
export const ChevronLeft = makeIcon(LuChevronLeft, PxChevronLeft);
export const ChevronRight = makeIcon(LuChevronRight, PxChevronRight);
export const ChevronUp = makeIcon(LuChevronUp, PxChevronUp);
export const ChevronsLeft = makeIcon(LuChevronsLeft, PxSquareChevronLeft);
export const ChevronsRight = makeIcon(LuChevronsRight, PxSquareChevronRight);
export const Clock = makeIcon(LuClock, PxClock);
export const Code = makeIcon(LuCode, PxCode);
export const Columns = makeIcon(LuColumns, null);
export const ClipboardPaste = makeIcon(LuClipboardPaste, PxClipboard);
export const GripVertical = makeIcon(LuGripVertical, PxMenu);
export const Copy = makeIcon(LuCopy, PxCopy);
export const Scissors = makeIcon(LuScissors, PxScissors);
export const CornerDownLeft = makeIcon(LuCornerDownLeft, PxCornerDownLeft);
export const Crown = makeIcon(LuCrown, PxCrown);
export const Database = makeIcon(LuDatabase, PxDatabase);
export const Download = makeIcon(LuDownload, PxDownload);
export const Edit3 = makeIcon(LuEdit3, PxPencil);
export const ExternalLink = makeIcon(LuExternalLink, PxExternalLink);
export const Eye = makeIcon(LuEye, PxEye);
export const File = makeIcon(LuFile, PxFile);
export const FileArchive = makeIcon(LuFileArchive, PxArchive);
export const FileCode = makeIcon(LuFileCode, PxCode);
export const FileImage = makeIcon(LuFileImage, PxImage);
export const FilePlus = makeIcon(LuFilePlus, null);
export const FileText = makeIcon(LuFileText, PxFileText);
export const Film = makeIcon(LuFilm, PxVideo);
export const Filter = makeIcon(LuFilter, PxFilter);
export const Folder = makeIcon(LuFolder, PxFolder);
export const FolderArchive = makeIcon(LuFolderArchive, PxFolder);
export const FolderInput = makeIcon(LuFolderInput, PxMove);
export const FolderPlus = makeIcon(LuFolderPlus, PxFolderPlus);
export const Globe = makeIcon(LuGlobe, PxGlobe);
export const Grid = makeIcon(LuGrid, PxGrid3x3);
export const HardDrive = makeIcon(LuHardDrive, PxServer);
export const Heading1 = makeIcon(LuHeading1, PxHeading1);
export const Heading2 = makeIcon(LuHeading2, PxHeading2);
export const Heading3 = makeIcon(LuHeading3, PxHeading3);
export const HelpCircle = makeIcon(LuHelpCircle, PxCircleQuestion);
export const Home = makeIcon(LuHome, PxHome);
export const Image = makeIcon(LuImage, PxImage);
export const Info = makeIcon(LuInfo, PxCircleInfo);
export const Italic = makeIcon(LuItalic, null);
export const KeyRound = makeIcon(LuKeyRound, PxKey);
export const Layers = makeIcon(LuLayers, null);
export const Link = makeIcon(LuLink, PxLink);
export const List = makeIcon(LuList, PxBulletlist);
export const ListOrdered = makeIcon(LuListOrdered, null);
export const Loader2 = makeIcon(LuLoader2, PxLoader);
export const Lock = makeIcon(LuLock, PxLock);
export const LogIn = makeIcon(LuLogIn, PxLogin);
export const LogOut = makeIcon(LuLogOut, PxLogout);
export const Mail = makeIcon(LuMail, PxMail);
export const Maximize2 = makeIcon(LuMaximize2, PxExpand);
export const Minimize2 = makeIcon(LuMinimize2, PxCollapse);
export const Minus = makeIcon(LuMinus, PxMinus);
export const Moon = makeIcon(LuMoon, PxMoon);
export const MoreHorizontal = makeIcon(LuMoreHorizontal, PxMoreHorizontal);
export const MoreVertical = makeIcon(LuMoreVertical, PxMoreVertical);
export const Music = makeIcon(LuMusic, PxMusic);
export const Palette = makeIcon(LuPalette, PxColorsSwatch);
export const Paperclip = makeIcon(LuPaperclip, PxAttachment);
export const Play = makeIcon(LuPlay, PxPlay);
export const Plus = makeIcon(LuPlus, PxPlus);
export const Quote = makeIcon(LuQuote, PxQuoteTextInline);
export const RefreshCw = makeIcon(LuRefreshCw, PxRefresh);
export const Replace = makeIcon(LuReplace, null);
export const RotateCcw = makeIcon(LuRotateCcw, null);
export const RotateCw = makeIcon(LuRotateCw, null);
export const Save = makeIcon(LuSave, PxSave);
export const Search = makeIcon(LuSearch, PxSearch);
export const Send = makeIcon(LuSend, PxSend);
export const Settings = makeIcon(LuSettings, PxSettingsCog);
export const Shield = makeIcon(LuShield, PxShield);
export const ShieldAlert = makeIcon(LuShieldAlert, PxShield);
export const ShieldCheck = makeIcon(LuShieldCheck, PxShield);
export const SlidersHorizontal = makeIcon(LuSlidersHorizontal, PxSlidersHorizontal);
export const Sparkles = makeIcon(LuSparkles, PxSparkles);
export const Square = makeIcon(LuSquare, PxSquare);
export const Star = makeIcon(LuStar, PxStar);
export const Strikethrough = makeIcon(LuStrikethrough, null);
export const Sun = makeIcon(LuSun, PxSun);
export const Table = makeIcon(LuTable, null);
export const Terminal = makeIcon(LuTerminal, PxTerminal);
export const Trash2 = makeIcon(LuTrash2, PxTrash);
export const UploadCloud = makeIcon(LuUploadCloud, PxUpload);
export const User = makeIcon(LuUser, PxUser);
export const UserCheck = makeIcon(LuUserCheck, PxUser);
export const UserPlus = makeIcon(LuUserPlus, PxUserPlus);
export const UserX = makeIcon(LuUserX, PxUserX);
export const Users = makeIcon(LuUsers, PxUsers);
export const Video = makeIcon(LuVideo, PxVideo);
export const Volume2 = makeIcon(LuVolume2, PxVolume2);
// Named "X" for the close-button use case (matching lucide's own icon name)
// throughout the app, not the letter X — pixelarticons' own "X" is a bold
// glyph shaped like the letter (and, at small close-button sizes, reads as
// the X/Twitter logo instead of a close affordance). "Close" is the icon
// pixelarticons actually ships for this purpose.
export const X = makeIcon(LuX, PxClose);
export const XCircle = makeIcon(LuXCircle, PxCancel);
export const ZoomIn = makeIcon(LuZoomIn, PxZoomIn);
export const ZoomOut = makeIcon(LuZoomOut, PxZoomOut);

// Not swapped for matrix theme (kept as lucide always) — no pixelarticons
// equivalent close enough to be worth a semantic substitute: Bold, Columns, FilePlus, Italic, Layers, ListOrdered, Replace, RotateCcw, RotateCw, Strikethrough, Table
