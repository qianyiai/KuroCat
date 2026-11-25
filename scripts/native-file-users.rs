//! Read-only Restart Manager query for one retained fixture. Never calls shutdown/restart.
use std::{fs,io,path::{Path,PathBuf},os::windows::ffi::OsStrExt,ptr};
#[repr(C)]#[derive(Clone,Copy)]struct FileTime{low:u32,high:u32}
#[repr(C)]#[derive(Clone,Copy)]struct UniqueProcess{pid:u32,started:FileTime}
#[repr(C)]#[derive(Clone,Copy)]struct ProcessInfo{
    process:UniqueProcess,app:[u16;256],service:[u16;64],kind:i32,status:u32,session:u32,restartable:i32,
}
#[link(name="Rstrtmgr")]
unsafe extern "system"{
    fn RmStartSession(session:*mut u32,flags:u32,key:*mut u16)->u32;
    fn RmRegisterResources(session:u32,files:u32,names:*const *const u16,apps:u32,processes:*const UniqueProcess,services:u32,service_names:*const *const u16)->u32;
    fn RmGetList(session:u32,needed:*mut u32,count:*mut u32,apps:*mut ProcessInfo,reasons:*mut u32)->u32;
    fn RmEndSession(session:u32)->u32;
}
#[link(name="kernel32")]
unsafe extern "system"{
    fn CreateFileW(name:*const u16,access:u32,share:u32,security:*const std::ffi::c_void,creation:u32,flags:u32,template:*mut std::ffi::c_void)->*mut std::ffi::c_void;
    fn CloseHandle(handle:*mut std::ffi::c_void)->i32;
}
fn query_directory_access(path:&Path,access:u32,label:&str){
    let name:Vec<u16>=path.as_os_str().encode_wide().chain(Some(0)).collect();
    // OPEN_EXISTING + FILE_FLAG_BACKUP_SEMANTICS. Requests rights but never sets disposition,
    // renames, creates, or deletes anything. Share all access and close the diagnostic handle.
    let handle=unsafe{CreateFileW(name.as_ptr(),access,7,ptr::null(),3,0x0200_0000,ptr::null_mut())};
    if handle as isize == -1 {println!("{label}: DENIED {}",io::Error::last_os_error());}
    else{unsafe{CloseHandle(handle);}println!("{label}: GRANTED");}
}
struct Session(u32);
impl Drop for Session{fn drop(&mut self){unsafe{RmEndSession(self.0);}}}
fn collect(root:&Path,files:&mut Vec<PathBuf>)->io::Result<()>{
    for entry in fs::read_dir(root)?{let entry=entry?;let kind=entry.file_type()?;
        if kind.is_dir(){collect(&entry.path(),files)?;}else if kind.is_file(){files.push(entry.path());}
        if files.len()>128{return Err(io::Error::other("Fixture exceeds 128 files"));}
    }Ok(())
}
fn check(code:u32)->io::Result<()>{if code==0{Ok(())}else{Err(io::Error::from_raw_os_error(code as i32))}}
fn main()->io::Result<()>{
    let root=PathBuf::from(std::env::args_os().nth(1).expect("absolute retained fixture directory"));
    assert!(root.is_absolute());assert_eq!(std::mem::size_of::<ProcessInfo>(),668);
    query_directory_access(&root,0x0001_0000,"source_directory_rename_access");
    if let Some(target)=std::env::args_os().nth(2){let target=PathBuf::from(target);assert!(target.is_absolute());query_directory_access(&target,4,"destination_parent_add_subdirectory_access");}
    let mut files=Vec::new();collect(&root,&mut files)?;assert!(!files.is_empty());
    let names:Vec<Vec<u16>>=files.iter().map(|p|p.as_os_str().encode_wide().chain(Some(0)).collect()).collect();
    let pointers:Vec<*const u16>=names.iter().map(|p|p.as_ptr()).collect();
    let mut handle=0;let mut key=[0u16;33];check(unsafe{RmStartSession(&mut handle,0,key.as_mut_ptr())})?;
    let session=Session(handle);
    check(unsafe{RmRegisterResources(session.0,pointers.len() as u32,pointers.as_ptr(),0,ptr::null(),0,ptr::null())})?;
    let(mut needed,mut count,mut reasons)=(0,0,0);
    let first=unsafe{RmGetList(session.0,&mut needed,&mut count,ptr::null_mut(),&mut reasons)};
    if first!=0&&first!=234{check(first)?;}
    println!("files: {}, affected_processes: {}",files.len(),needed);
    if needed>0{
        if needed>256{return Err(io::Error::other("Unexpectedly large affected-process list"));}
        let mut processes=vec![unsafe{std::mem::zeroed::<ProcessInfo>()};needed as usize];count=needed;
        check(unsafe{RmGetList(session.0,&mut needed,&mut count,processes.as_mut_ptr(),&mut reasons)})?;
        for process in processes.iter().take(count as usize){let end=process.app.iter().position(|c|*c==0).unwrap_or(256);
            println!("pid: {}, app: {}",process.process.pid,String::from_utf16_lossy(&process.app[..end]));}
    }
    println!("read_only_query: true; directory-only handles and transient prior locks are outside this query");Ok(())
}
