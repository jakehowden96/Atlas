import Close from "./sheet-close.svelte";
import Content from "./sheet-content.svelte";
import Body from "../dialog/dialog-body.svelte";
import Description from "../dialog/dialog-description.svelte";
import Footer from "../dialog/dialog-footer.svelte";
import Header from "../dialog/dialog-header.svelte";
import Overlay from "./sheet-overlay.svelte";
import Portal from "./sheet-portal.svelte";
import Title from "../dialog/dialog-title.svelte";
import Trigger from "./sheet-trigger.svelte";
import Root from "./sheet.svelte";

export {
  Root,
  Close,
  Trigger,
  Portal,
  Overlay,
  Content,
  Header,
  Footer,
  Title,
  Description,
  Body,
  //
  Root as Sheet,
  Close as SheetClose,
  Trigger as SheetTrigger,
  Portal as SheetPortal,
  Overlay as SheetOverlay,
  Content as SheetContent,
  Header as SheetHeader,
  Footer as SheetFooter,
  Title as SheetTitle,
  Description as SheetDescription,
  Body as SheetBody,
};
