//! Minimal std-only counterpart of probe-native-publication.mjs. Retains all fixtures.
use std::{fs,io::{self,Write},path::{Path,PathBuf},time::{SystemTime,UNIX_EPOCH}};
fn create_plain_dir(path:&Path)->io::Result<()>{
    fs::create_dir_all(path)?;
    for ancestor in path.ancestors(){let _=fs::symlink_metadata(ancestor)?;}
    Ok(())
}
fn main()->io::Result<()>{
    let mut args=std::env::args_os().skip(1);
    let parent=PathBuf::from(args.next().expect("absolute temporary parent"));
    let source=PathBuf::from(args.next().expect("absolute motion-fixture source"));
    assert!(parent.is_absolute()&&source.is_absolute());
    let nonce=SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let root=parent.join(format!("rust-publication-{}-{nonce}",std::process::id()));
    fs::create_dir_all(&root)?;
    let shaped=std::env::args().any(|arg|arg=="--import-shaped-only");
    let root=if shaped{root.join("appdata/kuro-cat-pet")}else{root};create_plain_dir(&root)?;
    let _catalog_lock=if std::env::args().any(|arg|arg=="--catalog-lock"){
        let file=fs::OpenOptions::new().read(true).write(true).create_new(true).open(root.join("character-import.lock"))?;
        file.lock()?;println!("catalog_lock: held outside staged directory");Some(file)
    }else{None};
    let kinds=if shaped{vec!["png-package-import-shaped"]}else{vec!["file","empty-directory","populated-directory","png-package","png-package-cross-parent"]};
    for kind in kinds{
        let stage=if shaped{root.join("character-import-staging").join(format!("{}-{nonce}",std::process::id()))}else{root.join(format!("{kind}-stage"))};
        create_plain_dir(stage.parent().unwrap())?;
        let destination=if kind=="png-package-cross-parent"||shaped{root.join("characters/motion-fixture").join("8014f6cd8e075018c3466d51dfbb3d351f38629551287596249922ec0147187b")}
            else{root.join(format!("{kind}-revision"))};
        assert!(stage.starts_with(&root)&&destination.starts_with(&root));
        if !shaped{create_plain_dir(destination.parent().unwrap())?;}
        if kind=="file"{fs::write(&stage,b"owned publication probe")?;}
        else{
            fs::create_dir(&stage)?;
            if kind=="populated-directory"{fs::create_dir(stage.join("assets"))?;fs::write(stage.join("assets/sprite.txt"),b"owned publication probe")?;}
            if kind.starts_with("png-package"){
                let mut names=["character.json","assets/primary/notail_idle.png","assets/primary/notail_blink.png",
                    "assets/primary/notail_shy.png","assets/primary/notail_happy2.png","assets/alternate/notail_idle.png",
                    "assets/alternate/notail_blink.png","assets/alternate/notail_shy.png","assets/alternate/notail_happy2.png"];
                if shaped{names.sort_unstable();}
                for name in names{
                    let target=stage.join(name);create_plain_dir(target.parent().unwrap())?;
                    let mut file=fs::OpenOptions::new().write(true).create_new(true).open(target)?;
                    file.write_all(&fs::read(source.join(name))?)?;file.sync_all()?;
                }
            }
        }
        if shaped{create_plain_dir(destination.parent().unwrap())?;}
        match fs::rename(&stage,&destination){
            Ok(())=>println!("{kind}: OK"),
            Err(error)=>println!("{kind}: ERROR {:?} {error}",error.raw_os_error()),
        }
    }
    println!("fixture: {}",root.display());
    Ok(())
}
