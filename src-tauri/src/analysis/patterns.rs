use regex::Regex;
use std::sync::LazyLock;

#[derive(Debug, Clone, PartialEq)]
pub enum DefinitionKind {
    Function,
    Class,
    Struct,
    Enum,
    Interface,
    Trait,
    Method,
    Module,
}

impl std::fmt::Display for DefinitionKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Function => write!(f, "function"),
            Self::Class => write!(f, "class"),
            Self::Struct => write!(f, "struct"),
            Self::Enum => write!(f, "enum"),
            Self::Interface => write!(f, "interface"),
            Self::Trait => write!(f, "trait"),
            Self::Method => write!(f, "method"),
            Self::Module => write!(f, "module"),
        }
    }
}

pub struct DefinitionPattern {
    pub regex: Regex,
    pub kind: DefinitionKind,
    pub name_group: usize,
}

pub struct ImportPattern {
    pub regex: Regex,
    pub source_group: usize,
    pub names_group: Option<usize>,
}

pub struct LanguagePatterns {
    pub definitions: Vec<DefinitionPattern>,
    pub imports: Vec<ImportPattern>,
}

pub fn detect_language(path: &str) -> Option<&'static str> {
    let ext = path.rsplit('.').next()?;
    match ext {
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "svelte" => Some("typescript"),
        "rs" => Some("rust"),
        "py" => Some("python"),
        "go" => Some("go"),
        "cs" => Some("csharp"),
        _ => None,
    }
}

pub fn get_patterns(language: &str) -> Option<&'static LanguagePatterns> {
    match language {
        "typescript" => Some(&*TYPESCRIPT),
        "rust" => Some(&*RUST),
        "python" => Some(&*PYTHON),
        "go" => Some(&*GO),
        "csharp" => Some(&*CSHARP),
        _ => None,
    }
}

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).unwrap()
}

// ── TypeScript / JavaScript ──

static TYPESCRIPT: LazyLock<LanguagePatterns> = LazyLock::new(|| LanguagePatterns {
    definitions: vec![
        DefinitionPattern {
            regex: re(r"(?:export\s+)?(?:async\s+)?function\s+(\w+)"),
            kind: DefinitionKind::Function, name_group: 1,
        },
        DefinitionPattern {
            regex: re(r"(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>"),
            kind: DefinitionKind::Function, name_group: 1,
        },
        DefinitionPattern {
            regex: re(r"(?:export\s+)?(?:abstract\s+)?class\s+(\w+)"),
            kind: DefinitionKind::Class, name_group: 1,
        },
        DefinitionPattern {
            regex: re(r"(?:export\s+)?interface\s+(\w+)"),
            kind: DefinitionKind::Interface, name_group: 1,
        },
    ],
    imports: vec![
        ImportPattern {
            regex: re(r#"import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]"#),
            source_group: 2, names_group: Some(1),
        },
        ImportPattern {
            regex: re(r#"import\s+(\w+)\s+from\s+['"]([^'"]+)['"]"#),
            source_group: 2, names_group: Some(1),
        },
    ],
});

// ── Rust ──

static RUST: LazyLock<LanguagePatterns> = LazyLock::new(|| LanguagePatterns {
    definitions: vec![
        DefinitionPattern {
            regex: re(r"(?:pub(?:\s*\(crate\))?\s+)?(?:async\s+)?fn\s+(\w+)"),
            kind: DefinitionKind::Function, name_group: 1,
        },
        DefinitionPattern {
            regex: re(r"(?:pub(?:\s*\(crate\))?\s+)?struct\s+(\w+)"),
            kind: DefinitionKind::Struct, name_group: 1,
        },
        DefinitionPattern {
            regex: re(r"(?:pub(?:\s*\(crate\))?\s+)?enum\s+(\w+)"),
            kind: DefinitionKind::Enum, name_group: 1,
        },
        DefinitionPattern {
            regex: re(r"(?:pub(?:\s*\(crate\))?\s+)?trait\s+(\w+)"),
            kind: DefinitionKind::Trait, name_group: 1,
        },
        DefinitionPattern {
            regex: re(r"impl(?:<[^>]*>)?\s+(\w+)"),
            kind: DefinitionKind::Struct, name_group: 1,
        },
    ],
    imports: vec![
        ImportPattern {
            regex: re(r"use\s+([^;]+);"),
            source_group: 1, names_group: None,
        },
    ],
});

// ── Python ──

static PYTHON: LazyLock<LanguagePatterns> = LazyLock::new(|| LanguagePatterns {
    definitions: vec![
        DefinitionPattern {
            regex: re(r"def\s+(\w+)\s*\("),
            kind: DefinitionKind::Function, name_group: 1,
        },
        DefinitionPattern {
            regex: re(r"class\s+(\w+)"),
            kind: DefinitionKind::Class, name_group: 1,
        },
    ],
    imports: vec![
        ImportPattern {
            regex: re(r"from\s+(\S+)\s+import\s+(.+)"),
            source_group: 1, names_group: Some(2),
        },
        ImportPattern {
            regex: re(r"^import\s+(.+)"),
            source_group: 1, names_group: None,
        },
    ],
});

// ── Go ──

static GO: LazyLock<LanguagePatterns> = LazyLock::new(|| LanguagePatterns {
    definitions: vec![
        DefinitionPattern {
            regex: re(r"func\s+(\w+)\s*\("),
            kind: DefinitionKind::Function, name_group: 1,
        },
        DefinitionPattern {
            regex: re(r"func\s+\(\w+\s+\*?(\w+)\)\s+(\w+)\s*\("),
            kind: DefinitionKind::Method, name_group: 2,
        },
        DefinitionPattern {
            regex: re(r"type\s+(\w+)\s+(?:struct|interface)"),
            kind: DefinitionKind::Struct, name_group: 1,
        },
    ],
    imports: vec![
        ImportPattern {
            regex: re(r#""([^"]+)""#),
            source_group: 1, names_group: None,
        },
    ],
});

// ── C# ──

static CSHARP: LazyLock<LanguagePatterns> = LazyLock::new(|| LanguagePatterns {
    definitions: vec![
        DefinitionPattern {
            regex: re(r"(?:public|private|internal|protected)?\s*(?:static\s+)?(?:partial\s+)?class\s+(\w+)"),
            kind: DefinitionKind::Class, name_group: 1,
        },
        DefinitionPattern {
            regex: re(r"(?:public|private|internal)?\s*interface\s+(\w+)"),
            kind: DefinitionKind::Interface, name_group: 1,
        },
        DefinitionPattern {
            regex: re(r"(?:public|private|internal|protected)\s+(?:static\s+)?(?:async\s+)?(?:override\s+)?(?:virtual\s+)?[\w<>\[\],\s]+\s+(\w+)\s*\("),
            kind: DefinitionKind::Method, name_group: 1,
        },
    ],
    imports: vec![
        ImportPattern {
            regex: re(r"using\s+([^;]+);"),
            source_group: 1, names_group: None,
        },
    ],
});

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_typescript_extensions() {
        assert_eq!(detect_language("src/app.ts"), Some("typescript"));
        assert_eq!(detect_language("src/App.tsx"), Some("typescript"));
        assert_eq!(detect_language("index.js"), Some("typescript"));
        assert_eq!(detect_language("lib.svelte"), Some("typescript"));
        assert_eq!(detect_language("utils.mjs"), Some("typescript"));
    }

    #[test]
    fn detect_rust() {
        assert_eq!(detect_language("src/main.rs"), Some("rust"));
    }

    #[test]
    fn detect_python() {
        assert_eq!(detect_language("app.py"), Some("python"));
    }

    #[test]
    fn detect_go() {
        assert_eq!(detect_language("main.go"), Some("go"));
    }

    #[test]
    fn detect_csharp() {
        assert_eq!(detect_language("Program.cs"), Some("csharp"));
    }

    #[test]
    fn detect_unknown() {
        assert_eq!(detect_language("readme.md"), None);
        assert_eq!(detect_language("config.yaml"), None);
    }

    #[test]
    fn ts_function_pattern() {
        let pats = get_patterns("typescript").unwrap();
        let line = "export async function handleSaveKey() {";
        let cap = pats.definitions[0].regex.captures(line).unwrap();
        assert_eq!(&cap[1], "handleSaveKey");
    }

    #[test]
    fn ts_arrow_pattern() {
        let pats = get_patterns("typescript").unwrap();
        let line = "const layoutFlowGraph = (edges: FlowEdge[]) => {";
        let cap = pats.definitions[1].regex.captures(line).unwrap();
        assert_eq!(&cap[1], "layoutFlowGraph");
    }

    #[test]
    fn ts_class_pattern() {
        let pats = get_patterns("typescript").unwrap();
        let line = "export abstract class BaseComponent {";
        let cap = pats.definitions[2].regex.captures(line).unwrap();
        assert_eq!(&cap[1], "BaseComponent");
    }

    #[test]
    fn ts_import_named_pattern() {
        let pats = get_patterns("typescript").unwrap();
        let line = r#"import { SvelteFlow, Background } from "@xyflow/svelte";"#;
        let cap = pats.imports[0].regex.captures(line).unwrap();
        assert_eq!(&cap[2], "@xyflow/svelte");
        assert!(cap[1].contains("SvelteFlow"));
    }

    #[test]
    fn rust_fn_pattern() {
        let pats = get_patterns("rust").unwrap();
        let line = "pub async fn analyze_diff(";
        let cap = pats.definitions[0].regex.captures(line).unwrap();
        assert_eq!(&cap[1], "analyze_diff");
    }

    #[test]
    fn rust_struct_pattern() {
        let pats = get_patterns("rust").unwrap();
        let line = "pub struct FlowData {";
        let cap = pats.definitions[1].regex.captures(line).unwrap();
        assert_eq!(&cap[1], "FlowData");
    }

    #[test]
    fn python_def_pattern() {
        let pats = get_patterns("python").unwrap();
        let line = "def process_data(self, items):";
        let cap = pats.definitions[0].regex.captures(line).unwrap();
        assert_eq!(&cap[1], "process_data");
    }

    #[test]
    fn go_func_pattern() {
        let pats = get_patterns("go").unwrap();
        let line = "func HandleRequest(w http.ResponseWriter, r *http.Request) {";
        let cap = pats.definitions[0].regex.captures(line).unwrap();
        assert_eq!(&cap[1], "HandleRequest");
    }

    #[test]
    fn go_method_pattern() {
        let pats = get_patterns("go").unwrap();
        let line = "func (s *Server) Start() error {";
        let cap = pats.definitions[1].regex.captures(line).unwrap();
        assert_eq!(&cap[2], "Start");
    }

    #[test]
    fn csharp_class_pattern() {
        let pats = get_patterns("csharp").unwrap();
        let line = "public partial class UserService {";
        let cap = pats.definitions[0].regex.captures(line).unwrap();
        assert_eq!(&cap[1], "UserService");
    }

    #[test]
    fn csharp_method_pattern() {
        let pats = get_patterns("csharp").unwrap();
        let line = "public async Task<User> GetUserAsync(int id)";
        let cap = pats.definitions[2].regex.captures(line).unwrap();
        assert_eq!(&cap[1], "GetUserAsync");
    }
}
