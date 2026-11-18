import {Children, isValidElement, useState, useCallback, type ReactNode, type Ref, type ComponentPropsWithoutRef} from 'react';
import * as Select from '@radix-ui/react-select';

// Keep the native option authoring shape; behavior belongs to Radix, not individual forms.
type Props = Omit<ComponentPropsWithoutRef<'button'>, 'value'|'defaultValue'|'onChange'|'children'> & {
 value: string; children: ReactNode; name?: string; required?: boolean;
 onChange?: (event: {target: {value: string}}) => void;
 ref?: Ref<HTMLButtonElement>;
};
const encode = (value:string) => `value:${value}`;
function labelText(node: ReactNode): string {
 return Children.toArray(node).map(child => isValidElement<{children?:ReactNode}>(child) ? labelText(child.props.children) : String(child)).join('');
}
export function BoardSelect({value,children,onChange,disabled,name,required,ref,className='',...props}:Props) {
 const [container,setContainer]=useState<HTMLElement|null>(null);
 const triggerRef=useCallback((node:HTMLButtonElement|null)=>{setContainer(node?.closest('dialog')??null);if(typeof ref==='function')ref(node);else if(ref)ref.current=node},[ref]);
 const options=Children.toArray(children).filter(isValidElement<{value:string;disabled?:boolean;children:ReactNode}>);
 return <Select.Root value={encode(value)} onValueChange={next=>onChange?.({target:{value:next.slice(6)}})} disabled={disabled} name={name} required={required}>
  <Select.Trigger {...props} data-value={value} ref={triggerRef} className={`board-select ${className}`}>
   <Select.Value /><Select.Icon className="board-select-chevron"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></Select.Icon>
  </Select.Trigger>
  <Select.Portal container={container}>
   <Select.Content className="board-select-popup" position="popper" sideOffset={5} collisionPadding={12}>
    <Select.ScrollUpButton className="board-select-scroll" aria-label="向上滚动">⌃</Select.ScrollUpButton>
    <Select.Viewport className="board-select-options">
     {options.map(option=><Select.Item key={option.props.value} value={encode(option.props.value)} data-value={option.props.value} disabled={option.props.disabled} textValue={labelText(option.props.children)} className="board-select-option">
      <Select.ItemText>{option.props.children}</Select.ItemText><Select.ItemIndicator className="board-select-check"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></Select.ItemIndicator>
     </Select.Item>)}
    </Select.Viewport>
    <Select.ScrollDownButton className="board-select-scroll" aria-label="向下滚动">⌄</Select.ScrollDownButton>
   </Select.Content>
  </Select.Portal>
 </Select.Root>;
}
