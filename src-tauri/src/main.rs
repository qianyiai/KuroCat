#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--mcp") {
        kuro_cat_pet_lib::run_mcp_stdio();
        return;
    }
    if args.iter().any(|a| a == "--hook") {
        kuro_cat_pet_lib::run_hook_cli(&args);
        return;
    }
    if let Some(action) = kuro_cat_pet_lib::parse_admin_autostart_cli_action(&args) {
        let code = kuro_cat_pet_lib::run_admin_autostart_cli(action);
        std::process::exit(code);
    }
    kuro_cat_pet_lib::run();
}
