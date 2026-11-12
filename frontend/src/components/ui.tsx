/**
 * Compatibility layer: every export that existed here before the design system
 * is still available with the same props, now implemented in components/ds.
 * New code should import from "@/components/ds".
 */
export {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LinkButton,
  Loading,
  Modal,
  PageHeader,
  Select,
  Stat,
  StatusBadge,
  SyntheticNote,
  Table,
  Td,
  Textarea,
} from "./ds";
