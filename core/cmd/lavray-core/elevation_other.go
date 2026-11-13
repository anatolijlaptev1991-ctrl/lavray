// SPDX-License-Identifier: GPL-3.0-only

//go:build !windows && !linux

package main

// tunPrivilegeCheck — на этой ОС права на TUN заранее не проверяются: root,
// capabilities и сетевые пространства имён слишком разнообразны, а sing-box
// сам сообщит причину при старте.
var tunPrivilegeCheck func() error
