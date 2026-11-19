---
name: loxone-picoc
description: >-
  Write and edit Loxone PicoC interpreter scripts in src/loxone so they compile
  and run on the Miniserver. Use when editing those .c files, a PicoC block,
  Loxone Config program code, or when Display values shows "illegal character"
  or outputs stuck at 0.
---

# Loxone PicoC scripts

Scripts in `src/loxone/*.c` are pasted into a PicoC block in Loxone Config and saved to the Miniserver. The file in git is not the running program. After a change, the user pastes the whole script into the block and saves. Say that when you change one.

PicoC is a small C interpreter, not the compiler on this machine. A script that looks fine here can still fail on the Miniserver.

## ASCII only

Every byte in the file must be plain ASCII, including comments and strings. Loxone rejects the script otherwise.

Forbidden:

- Czech and other letters with accents (`í`, `ě`, `ř`, `ý`)
- Smart quotes, em dashes, ellipsis, non-breaking spaces

The failure looks like this in Display values: Error text is `block name:line:column illegal character`, and every output stays 0. The script did not start. Column numbers match the source, so an `í` in a comment is enough to stop the block.

Before handing a script back, check that no byte is above 127. Fix any hit, including in comments the user will not notice.

## Shape of a script

Match the existing blocks in `src/loxone/`.

Start with a block comment that is the wiring contract:

- What the block decides
- Each input, in order, with its unit
- Each output, in order, with its unit and what the values mean
- Each virtual input by name (`VI18`) and what it carries
- Text outputs, in order

Then `#define` constants: input indexes, output indexes, virtual-input names, timings, and limits. A number that is a register value or a mode gets the name used in the comment, not a bare literal at the call.

The program is one `while (TRUE)` loop. End the loop with `sleep`. One second is the usual period. A comment must say why a loop is slower.

## Inputs and outputs

Input and output indexes in code start at 0. Display values in Config starts at 1. `setoutput(0, x)` is Output 1. `setoutputtext(0, s)` is Text output 1. Error text is the compiler message, not a text output.

Add a new input or output at the end. Never insert one in front of an existing one. Existing wires are numbered, and inserting shifts them onto the wrong values. The header comment says "Add it at the end. Do not insert it in front."

An input that nothing reads does not belong. A value that is a constant stays a `#define`, not a fake input.

Virtual inputs are strings: `#define VI_PLAN_CAR "VI18"`, then `getio` and `setio`. Several blocks share them. Read the header of the block that writes one before writing it from somewhere else.

## PicoC limits

Use the calls these blocks already use: `getinput`, `getinputtext`, `getio`, `setio`, `setoutput`, `setoutputtext`, `httpget`, `sleep`, `getcurrenttime`, `gethour`, `getminute`.

`httpget` can return NULL. Check that before reading the body, and `free` the response. Do not call `httpget` every second. A failed fetch retries after a minute. Fetching on every pass runs the block out of memory.

Do not put secrets in the script or in a text output. An API key arrives on a text input and is not copied into a debug string.

## When outputs are 0

Output 1 and Output 2 at 0 means either the script did not compile, or it is running and really commanding 0. Read Error text first. `illegal character` means it did not compile. Fix the source, paste the whole script again, and save. A half-edited block on the Miniserver is the program that is running.
