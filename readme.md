# Olta: Echoes of Reality

## Contract Setup

- Details
  - Title: `echoes-of-reality-pilot`
  - Description: ``
  - Content Url: `http://epok.tech/olta-echoes-of-reality/`
  - Credits
    1.
      - Name: `epok.tech`
      - Role: `code ∩ creative ∩ art`
      - Address: `0x03c0Ec09395D5EA4a1D508B890D45F175d7101A1`
- Data
  - Collection
    - name: `forms`
    - type: `object`
    - Properties
      1.
        - name: `t`
        - type: `bigint`
        - min: `0`
        - max: `2`
        - Updated via: `set`
      2.
        - name: `r`
        - type: `bigint`
        - min: `1`
        - max: `100`
        - Updated via: `set`
      3.
        - name: `x`
        - type: `bigint`
        - min: `-9007199254740991`
        - max: `9007199254740991`
        - Updated via: `set`
      4.
        - name: `y`
        - type: `bigint`
        - min: `-9007199254740991`
        - max: `9007199254740991`
        - Updated via: `set`
      5.
        - name: `z`
        - type: `bigint`
        - min: `-9007199254740991`
        - max: `9007199254740991`
        - Updated via: `set`
    - Permissions
      - Creating: `Anyone` can create a document
      - Updating: `Only admin` can update `whole document`
    - Initial state
      - Generate `1000` documents with `random` properties
