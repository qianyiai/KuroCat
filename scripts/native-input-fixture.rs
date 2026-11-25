//! Local native input test surface. No accounts, networking, text reads or persistence.
#![windows_subsystem = "windows"]
use std::ffi::c_void;
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicI32,Ordering};
static LAST_FIELD:AtomicI32=AtomicI32::new(1);
type Handle = *mut c_void;
#[repr(C)]
struct WindowClass {
    style:u32, procedure:Option<unsafe extern "system" fn(Handle,u32,usize,isize)->isize>,
    class_extra:i32, window_extra:i32, instance:Handle, icon:Handle, cursor:Handle,
    background:Handle, menu:*const u16, name:*const u16,
}
#[repr(C)]
struct Message {window:Handle,id:u32,wparam:usize,lparam:isize,time:u32,x:i32,y:i32,private:u32}
#[link(name="user32")]
unsafe extern "system" {
    fn RegisterClassW(class:*const WindowClass)->u16;
    fn CreateWindowExW(ex:u32,class:*const u16,title:*const u16,style:u32,x:i32,y:i32,w:i32,h:i32,parent:Handle,menu:Handle,instance:Handle,param:Handle)->Handle;
    fn DefWindowProcW(window:Handle,message:u32,wparam:usize,lparam:isize)->isize;
    fn ShowWindow(window:Handle,command:i32)->i32;
    fn UpdateWindow(window:Handle)->i32;
    fn GetMessageW(message:*mut Message,window:Handle,min:u32,max:u32)->i32;
    fn TranslateMessage(message:*const Message)->i32;
    fn DispatchMessageW(message:*const Message)->isize;
    fn DestroyWindow(window:Handle)->i32;
    fn PostQuitMessage(code:i32);
    fn GetDlgItem(parent:Handle,id:i32)->Handle;
    fn SetFocus(window:Handle)->Handle;
}
#[link(name="kernel32")]
unsafe extern "system" {fn GetModuleHandleW(name:*const u16)->Handle;}
fn wide(value:&str)->Vec<u16>{value.encode_utf16().chain([0]).collect()}
unsafe fn control(parent:Handle,class:&str,title:&str,style:u32,y:i32,height:i32,id:usize){
    let child=unsafe{CreateWindowExW(0,wide(class).as_ptr(),wide(title).as_ptr(),0x50000000|style,
        20,y,410,height,parent,id as Handle,GetModuleHandleW(null()),null_mut())};
    assert!(!child.is_null());
}
unsafe extern "system" fn procedure(window:Handle,message:u32,wparam:usize,lparam:isize)->isize{
    match message {
        1=>{unsafe{
            control(window,"STATIC","Local test only - no accounts or real passwords.",0,15,22,10);
            control(window,"STATIC","Normal input",0,45,18,11);
            control(window,"EDIT","",0x00810080,66,28,1);
            control(window,"STATIC","Password-style test input",0,104,18,12);
            control(window,"EDIT","",0x008100A0,125,28,2);
            control(window,"BUTTON","Use normal test field (F7)",0x00010000,166,28,4);
            control(window,"BUTTON","Use password-style test field (F8)",0x00010000,199,28,5);
            control(window,"BUTTON","Close test window",0x00010000,237,28,3);
        }0},
        0x111 if wparam&0xffff==3=>{unsafe{DestroyWindow(window)};0},
        0x111 if wparam&0xffff==4 || wparam&0xffff==5=>{
            let field=if wparam&0xffff==4{1}else{2};LAST_FIELD.store(field,Ordering::Relaxed);
            unsafe{SetFocus(GetDlgItem(window,field))};0
        },
        0x111 if (wparam&0xffff==1 || wparam&0xffff==2) && wparam>>16==0x100=>{
            LAST_FIELD.store((wparam&0xffff) as i32,Ordering::Relaxed);0
        },
        6 if wparam&0xffff!=0=>{
            let result=unsafe{DefWindowProcW(window,message,wparam,lparam)};
            unsafe{SetFocus(GetDlgItem(window,LAST_FIELD.load(Ordering::Relaxed)))};result
        },
        2=>{unsafe{PostQuitMessage(0)};0},
        _=>unsafe{DefWindowProcW(window,message,wparam,lparam)},
    }
}
fn main(){unsafe{
    let name=wide("KuroCatNativeInputFixture");
    let class=WindowClass{style:0,procedure:Some(procedure),class_extra:0,window_extra:0,
        instance:GetModuleHandleW(null()),icon:null_mut(),cursor:null_mut(),background:6usize as Handle,menu:null(),name:name.as_ptr()};
    assert_ne!(RegisterClassW(&class),0);
    let window=CreateWindowExW(0,name.as_ptr(),wide("KuroCat input test fixture v2").as_ptr(),0x00CF0000,
        200,120,470,320,null_mut(),null_mut(),class.instance,null_mut());
    assert!(!window.is_null());ShowWindow(window,5);UpdateWindow(window);
    let mut message:Message=std::mem::zeroed();
    while GetMessageW(&mut message,null_mut(),0,0)>0{
        if message.id==0x100 && (message.wparam==0x76 || message.wparam==0x77){
            let field=if message.wparam==0x76{1}else{2};LAST_FIELD.store(field,Ordering::Relaxed);
            SetFocus(GetDlgItem(window,field));continue;
        }
        TranslateMessage(&message);DispatchMessageW(&message);
    }
}}
