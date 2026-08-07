# md-boss

* read doc/CODE_STRUCTURE.md first to understand the codebase architecture
* run `hammer build` after every batch of jobs -> when code is changed and you are done
* for text styles use only defined classes in app/Views/TextStyles.swift
* for colors use only tokens from app/Views/Theme.swift - never a literal `Color(red:...)` in a view
* preview HTML/CSS/JS lives in app/Resources/preview.{js,css}, not in Swift string literals
* the preview web view is *told* which theme to use - never add `prefers-color-scheme` to its CSS
* see ~/dev/AGENTS.md for global rules
