import type { ComponentPropsWithRef, ReactElement, ReactNode, RefAttributes } from "react";

export interface LinkProps extends ComponentPropsWithRef<"a"> {
  replace?: boolean;
  prefetch?: boolean;
}
export function Link(props: LinkProps): ReactElement;

export interface NavLinkProps extends Omit<LinkProps, "className" | "aria-current"> {
  end?: boolean;
  className?: string | ((state: { isActive: boolean }) => string | undefined);
}
export function NavLink(props: NavLinkProps): ReactElement;
export function navigate(target: string, options?: { replace?: boolean }): Promise<void>;

export type FormErrors = Record<string, string>;
export type FormResult<Data = unknown> =
  | { ok: true; data?: Data; response?: Response }
  | { ok: false; errors: FormErrors; data?: Data; response?: Response };
export interface FormState<Data = unknown> {
  pending: boolean;
  errors: FormErrors | null;
  data: Data | null;
}
export type FormMethod = "get" | "post" | "put" | "patch" | "delete";
export interface FormProps<Data = unknown> extends
  Omit<ComponentPropsWithRef<"form">, "action" | "children" | "method" | "encType"> {
  action?: string;
  method: FormMethod | Uppercase<FormMethod>;
  replace?: boolean;
  reset?: boolean;
  children?: ReactNode | ((state: FormState<Data>) => ReactNode);
  onResult?: (result: FormResult<Data>) => void;
}
export function Form<Data = unknown>(props: FormProps<Data> & RefAttributes<HTMLFormElement>): ReactElement;

export interface DocumentProps {
  children: ReactNode;
  head: ReactNode;
  nonce?: string;
}
export function ClientEntry(props: { src: string; nonce?: string }): ReactElement;
export function Stylesheet(): ReactElement | null;

export interface RouteMetadata {
  title?: string;
  description?: string;
  canonical?: string;
  robots?: string;
  meta?: Array<
    | { name: string; content: string; property?: never }
    | { property: string; content: string; name?: never }
  >;
  links?: Array<{
    rel: string;
    href: string;
    as?: string;
    type?: string;
    media?: string;
    sizes?: string;
    hrefLang?: string;
    crossOrigin?: string;
    referrerPolicy?: string;
    fetchPriority?: string;
    imageSrcSet?: string;
    imageSizes?: string;
    color?: string;
  }>;
}
export type Meta<Props extends object = Record<string, unknown>> = RouteMetadata |
  ((context: { props: Props; url: URL }) => RouteMetadata | undefined);
