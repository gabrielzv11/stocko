import { cn } from '@/lib/cn';
import { VariantProps } from 'class-variance-authority';
import { AnimatePresence, motion } from 'motion/react';
import { Select as SelectPrimitive } from 'radix-ui';
import * as React from 'react';

import { Button, ButtonProps } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/buttonGroup';
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerProps,
	DrawerTitle,
} from '@/components/ui/drawer';
import { Icon, IconName } from '@/components/ui/icons';
import { RippleContainer } from '@/components/ui/rippleContainer';
import { textVariants } from '@/components/ui/text';
import { textFieldVariants } from '@/components/ui/textField';
import { useIsMobile } from '@/hooks/use-mobile';

type Typography = VariantProps<typeof textVariants>['typography'];

// Estado compartilhado entre as partes; mobile usa Drawer, desktop usa Radix Select.
const SelectContext = React.createContext<{
	isMobile: boolean;
	value: string;
	onChange: (value: string) => void;
	open: boolean;
	setOpen: (open: boolean) => void;
}>({ isMobile: false, value: '', onChange: () => {}, open: false, setOpen: () => {} });

export interface SelectProps {
	value?: string;
	onValueChange?: (value: string) => void;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	drawerProps?: DrawerProps;
	children?: React.ReactNode;
}

function Select({ value = '', onValueChange, open: openProp, onOpenChange, drawerProps, children }: SelectProps) {
	const isMobile = useIsMobile('768');
	const [openState, setOpenState] = React.useState(false);
	const open = openProp ?? openState;

	function setOpen(next: boolean) {
		setOpenState(next);
		onOpenChange?.(next);
	}

	function onChange(next: string) {
		setOpen(false);
		onValueChange?.(next);
	}

	return (
		<SelectContext.Provider value={{ isMobile, value, onChange, open, setOpen }}>
			{isMobile ? (
				<Drawer {...drawerProps} open={open} onOpenChange={setOpen}>
					{children}
				</Drawer>
			) : (
				<SelectPrimitive.Root value={value} onValueChange={onChange} open={open} onOpenChange={setOpen}>
					{children}
				</SelectPrimitive.Root>
			)}
		</SelectContext.Provider>
	);
}

interface SelectTriggerProps {
	ornament?: IconName;
	size?: 'sm' | 'lg';
	typography?: Typography;
	className?: string;
	children?: React.ReactNode;
	'aria-label'?: string;
}

function SelectTrigger({ ornament, size = 'lg', typography = 'caption', className, children, ...props }: SelectTriggerProps) {
	const { isMobile, value, open, setOpen } = React.useContext(SelectContext);

	const ornamentIcon = ornament && (
		<span className='flex items-center'>
			<Icon icon={ornament} className={cn('text-emphasis-mid', size === 'sm' ? 'size-4' : 'size-5')} />
		</span>
	);
	const triggerClassName = cn(
		textFieldVariants({ size }),
		textVariants({ typography }),
		'text-primary relative flex w-full items-center justify-between overflow-hidden',
		className
	);
	const chevron = <Icon icon='chevron-down' className={cn('text-primary', size === 'sm' ? 'size-4' : 'size-5')} />;

	if (isMobile) {
		return (
			<RippleContainer>
				<button type='button' onClick={() => setOpen(true)} className={triggerClassName} {...props}>
					<AnimatePresence mode='wait'>
						<motion.div
							className='flex gap-2'
							key={value || 'placeholder'}
							initial={{ translateY: '150%', opacity: 0 }}
							animate={{ translateY: 0, opacity: 1 }}
							exit={{ translateY: '-150%', opacity: 0 }}
							transition={{ duration: 0.2, ease: 'easeInOut', type: 'spring' }}
						>
							{ornamentIcon}
							{children}
						</motion.div>
					</AnimatePresence>

					{chevron}
				</button>
			</RippleContainer>
		);
	}

	return (
		<RippleContainer>
			<SelectPrimitive.Trigger type='button' className={triggerClassName} {...props}>
				<span className='flex items-center gap-2'>
					{ornamentIcon}
					{children}
				</span>

				<SelectPrimitive.Icon asChild>
					<motion.span
						className='flex items-center'
						animate={{ rotate: open ? 180 : 0 }}
						transition={{ duration: 0.2, ease: 'easeInOut' }}
					>
						{chevron}
					</motion.span>
				</SelectPrimitive.Icon>
			</SelectPrimitive.Trigger>
		</RippleContainer>
	);
}

/** O conteúdo só monta aberto, então o rótulo do valor vem por children (fallback: o próprio valor). */
function SelectValue({ placeholder = 'Selecionar', children }: { placeholder?: string; children?: React.ReactNode }) {
	const { isMobile, value } = React.useContext(SelectContext);
	const label = children || value || placeholder;

	if (isMobile) return <>{label}</>;

	return (
		<SelectPrimitive.Value placeholder={placeholder}>
			<AnimatePresence mode='wait'>
				<motion.span
					key={value || 'placeholder'}
					initial={{ translateY: '150%', opacity: 0 }}
					animate={{ translateY: 0, opacity: 1 }}
					exit={{ translateY: '-150%', opacity: 0 }}
					transition={{ duration: 0.2, ease: 'easeInOut', type: 'spring' }}
					className='inline-block'
				>
					{label}
				</motion.span>
			</AnimatePresence>
		</SelectPrimitive.Value>
	);
}

function SelectContent({ children }: { children?: React.ReactNode }) {
	const { isMobile, open } = React.useContext(SelectContext);

	if (isMobile) {
		return (
			<DrawerContent>
				<DrawerTitle className='sr-only'>Escolha uma opção</DrawerTitle>
				{children}
			</DrawerContent>
		);
	}

	return (
		<AnimatePresence>
			{open && (
				<SelectPrimitive.Portal forceMount>
					<SelectPrimitive.Content asChild position='popper' sideOffset={0} align='end'>
						<motion.div
							className='bg-popover text-popover-foreground border-border z-50 mt-[calc(var(--radix-select-trigger-height)*-1)] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border p-1 shadow-xl'
							initial={{ opacity: 0, scale: 0.96, y: -4 }}
							animate={{ opacity: 1, scale: 1, y: 0 }}
							exit={{ opacity: 0, scale: 0.96, y: -4 }}
							transition={{ duration: 0.15, ease: 'easeInOut' }}
						>
							<SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
						</motion.div>
					</SelectPrimitive.Content>
				</SelectPrimitive.Portal>
			)}
		</AnimatePresence>
	);
}

/** Título (e descrição) do Drawer no mobile; no desktop não aparece, como no original. */
function SelectLabel({ description, children }: { description?: React.ReactNode; children?: React.ReactNode }) {
	const { isMobile } = React.useContext(SelectContext);
	if (!isMobile) return null;

	return (
		<DrawerHeader>
			{children && <DrawerTitle>{children}</DrawerTitle>}
			{description && <DrawerDescription>{description}</DrawerDescription>}
		</DrawerHeader>
	);
}

function SelectGroup({ className, children }: { className?: string; children?: React.ReactNode }) {
	const { isMobile } = React.useContext(SelectContext);

	if (!isMobile) return <SelectPrimitive.Group>{children}</SelectPrimitive.Group>;

	return (
		<DrawerFooter className={className}>
			<ButtonGroup orientation='vertical'>{children}</ButtonGroup>
		</DrawerFooter>
	);
}

interface SelectItemProps {
	value: string;
	typography?: Typography;
	disabled?: boolean;
	className?: string;
	children?: React.ReactNode;
	/** Só no mobile, onde cada item é um Button. */
	buttonProps?: ButtonProps;
}

function SelectItem({ value, typography = 'caption', disabled, className, children, buttonProps }: SelectItemProps) {
	const { isMobile, onChange } = React.useContext(SelectContext);

	if (isMobile) {
		return (
			<Button
				{...buttonProps}
				variant={buttonProps?.variant || 'secondary'}
				disabled={disabled}
				onClick={() => onChange(value)}
			>
				{children}
			</Button>
		);
	}

	return (
		<SelectPrimitive.Item
			value={value}
			disabled={disabled}
			className={cn(
				textVariants({ typography }),
				'text-primary data-[highlighted]:bg-accent relative flex cursor-pointer select-none items-center rounded-lg px-3 py-2 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
				className
			)}
		>
			<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
		</SelectPrimitive.Item>
	);
}

export { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue };
