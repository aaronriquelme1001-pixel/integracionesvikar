import os
import re
import sys
from fpdf import FPDF

class ProfessionalPDF(FPDF):
    def __init__(self, title_header="VIKAR GPS  |  Integraciones Telemáticas"):
        super().__init__(orientation="P", unit="mm", format="A4")
        self.set_margins(20, 20, 20)
        self.set_auto_page_break(auto=True, margin=22)
        self.title_header = title_header
        
        # Cargar fuentes del sistema Windows para asegurar soporte UTF-8 completo
        self.add_font("Arial", "", r"C:\Windows\Fonts\arial.ttf")
        self.add_font("Arial", "B", r"C:\Windows\Fonts\arialbd.ttf")
        self.add_font("Arial", "I", r"C:\Windows\Fonts\ariali.ttf")
        self.add_font("Arial", "BI", r"C:\Windows\Fonts\arialbi.ttf")
        
        # Registrar con un nombre diferente para evitar advertencias de fuente core de fpdf
        self.add_font("CourierNew", "", r"C:\Windows\Fonts\cour.ttf")
        self.add_font("CourierNew", "B", r"C:\Windows\Fonts\courbd.ttf")
        
        self.in_cover = True

    def header(self):
        if not self.in_cover:
            self.set_font("Arial", "I", 8)
            self.set_text_color(120, 130, 140)
            self.cell(0, 10, self.title_header, align="R")
            self.ln(4)
            self.set_draw_color(220, 225, 230)
            self.set_line_width(0.3)
            self.line(20, 18, 190, 18)
            self.ln(6)

    def footer(self):
        if not self.in_cover:
            self.set_y(-15)
            self.set_font("Arial", "I", 8)
            self.set_text_color(120, 130, 140)
            self.set_draw_color(220, 225, 230)
            self.set_line_width(0.3)
            self.line(20, 282, 190, 282)
            # Número de página alineado a la derecha
            self.cell(0, 10, f"Página {self.page_no()}", align="R")

def clean_special_chars(text):
    # Reemplazar caracteres de dibujo de cajas y emojis para evitar errores de codificación
    replacements = {
        '┌': '+', '┐': '+', '└': '+', '┘': '+',
        '─': '-', '│': '|', '┬': '+', '┴': '+', '┼': '+',
        '──>': '--->', '───>': '---->', '──': '--', '───': '---',
        '🔑': '[Key]', '📋': '[Checklist]', '📝': '[Form]',
        '⚙️': '[Config]', '🖋️': '[Signature]', '⚙': '[Config]',
        '✏️': '[Write]', '✏': '[Write]', '✔️': '[OK]', '✔': '[OK]',
        '❌': '[X]', '⬜': '[ ]', '⬛': '[x]', '⭐': '*', '🌟': '*',
        '🚩': '[Flag]', 'ℹ️': '[Info]', '💡': '[Idea]',
    }
    for k, v in replacements.items():
        text = text.replace(k, v)
    return text

def print_formatted_text(pdf, text, font_size=10, line_height=5.5):
    text = clean_special_chars(text)
    
    # Regex para extraer partes en negrita, código inline y texto normal
    parts = re.split(r'(\*\*.*?\*\*|`.*?`)', text)
    
    pdf.set_font("Arial", "", font_size)
    pdf.set_text_color(40, 40, 40)
    
    for part in parts:
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            # Texto en negrita
            content = part[2:-2]
            pdf.set_font("Arial", "B", font_size)
            pdf.write(line_height, content)
        elif part.startswith("`") and part.endswith("`"):
            # Código inline
            content = part[1:-1]
            pdf.set_font("CourierNew", "", font_size - 0.5)
            pdf.set_text_color(180, 50, 50)  # Color rojizo típico de código
            pdf.write(line_height, content)
            # Restaurar Arial normal
            pdf.set_font("Arial", "", font_size)
            pdf.set_text_color(40, 40, 40)
        else:
            # Texto normal
            pdf.set_font("Arial", "", font_size)
            pdf.write(line_height, part)

def draw_alert_box(pdf, alert_type, lines_text):
    text = " ".join(lines_text).strip()
    # Eliminar el prefijo del tipo de alerta si existe
    text = re.sub(r'^>?\s*\[!(NOTE|WARNING|IMPORTANT)\]\s*', '', text, flags=re.IGNORECASE)
    text = clean_special_chars(text)
    
    if "WARNING" in alert_type.upper() or "IMPORT" in alert_type.upper():
        bg_color = (255, 248, 230)      # Amarillo claro
        border_color = (255, 169, 64)   # Naranja
        text_color = (120, 60, 0)       # Café oscuro
        title = "ADVERTENCIA CRÍTICA"
    else:
        bg_color = (230, 247, 255)      # Celeste claro
        border_color = (24, 144, 255)   # Azul
        text_color = (0, 80, 160)       # Azul oscuro
        title = "NOTA DE OPERACIÓN"

    # Calcular altura de forma dinámica usando multi_cell en modo dry_run
    pdf.set_font("Arial", "", 9)
    # 170 mm de ancho menos los paddings (5mm izquierda y 5mm derecha)
    split_lines = pdf.multi_cell(160, 4.5, f"{title}: {text}", dry_run=True, output="LINES")
    h = len(split_lines) * 4.5 + 8

    # Salto de página preventivo
    if pdf.y + h > 260:
        pdf.add_page()

    start_x = pdf.x
    start_y = pdf.y

    # Fondo
    pdf.set_fill_color(*bg_color)
    pdf.rect(start_x, start_y, 170, h, style="F")

    # Borde grueso izquierdo
    pdf.set_fill_color(*border_color)
    pdf.rect(start_x, start_y, 2, h, style="F")

    # Contenido de la alerta
    pdf.set_xy(start_x + 6, start_y + 4)
    pdf.set_text_color(*text_color)
    pdf.set_font("Arial", "B", 9)
    pdf.write(4.5, f"{title}: ")
    pdf.set_font("Arial", "", 9)
    
    # Renderizar texto de la alerta con formato inline
    print_formatted_text(pdf, text, font_size=9, line_height=4.5)
    pdf.set_xy(start_x, start_y + h + 5)

def draw_code_block(pdf, lines):
    # Unir las líneas del bloque de código y limpiarlo de unicode conflictivo
    raw_text = "\n".join(lines).strip()
    text = clean_special_chars(raw_text)
    pdf.set_font("CourierNew", "", 8.5)
    
    # Calcular altura real considerando envoltura de líneas
    split_lines = pdf.multi_cell(162, 4.2, text, dry_run=True, output="LINES")
    num_lines = len(split_lines)
    h = num_lines * 4.2 + 6

    # Salto de página preventivo
    if pdf.y + h > 260:
        pdf.add_page()

    start_x = pdf.x
    start_y = pdf.y

    # Fondo gris
    pdf.set_fill_color(248, 248, 250)
    pdf.set_draw_color(220, 225, 230)
    pdf.set_line_width(0.3)
    pdf.rect(start_x, start_y, 170, h, style="FD")

    # Imprimir texto
    pdf.set_xy(start_x + 4, start_y + 3)
    pdf.set_text_color(160, 40, 40)
    pdf.multi_cell(162, 4.2, text, border=0, align="L")
    pdf.set_xy(start_x, start_y + h + 5)

def draw_table(pdf, rows):
    if not rows:
        return
    
    # Detectar ancho de columnas según el contenido. 
    # Para tabla de mandante (especificaciones datos standard): [Nombre, Tipo, Formato, Descripcion]
    # Ancho total: 170 mm
    widths = [38, 22, 45, 65]
    
    # Determinar si la primera fila es de cabecera
    clean_rows = []
    for r in rows:
        # Saltar las filas de separador de Markdown
        if re.match(r'^\s*\|\s*[:\-|\s]+$', r):
            continue
        cols = [c.strip() for c in r.split('|')[1:-1]]
        clean_rows.append(cols)

    # Renderizar cada fila
    for row_idx, cols in enumerate(clean_rows):
        is_header = (row_idx == 0)
        
        # Calcular altura requerida para la fila basado en el contenido más largo
        max_lines = 1
        lines_list = []
        for i, text in enumerate(cols):
            clean_text = text.replace("**", "").replace("`", "").replace("<br>", "\n").replace("<br/>", "\n")
            clean_text = clean_special_chars(clean_text)
            pdf.set_font("Arial", "B" if is_header else "", 8.5)
            # Obtener número de líneas virtuales que tomaría la celda
            virtual_lines = pdf.multi_cell(widths[i], 5, clean_text, dry_run=True, output="LINES")
            max_lines = max(max_lines, len(virtual_lines))
            lines_list.append(clean_text)
            
        row_h = max_lines * 4.8 + 3.5

        # Control de salto de página
        if pdf.y + row_h > 260:
            pdf.add_page()
            # Si saltamos página, volvemos a dibujar las cabeceras si no estamos en la cabecera misma
            if not is_header:
                draw_table(pdf, [rows[0]])
                
        # Coordenadas de inicio de fila
        x_start = pdf.x
        y_start = pdf.y
        
        for i, text in enumerate(lines_list):
            pdf.set_xy(x_start + sum(widths[:i]), y_start)
            if is_header:
                pdf.set_fill_color(27, 54, 93)   # Azul Vikar oscuro
                pdf.set_text_color(255, 255, 255)
                pdf.set_font("Arial", "B", 8.5)
                align = "C"
            else:
                if row_idx % 2 == 0:
                    pdf.set_fill_color(245, 247, 250)
                else:
                    pdf.set_fill_color(255, 255, 255)
                pdf.set_text_color(40, 40, 40)
                pdf.set_font("Arial", "", 8.5)
                align = "C" if (i == 1 or i == 0) else "L"

            pdf.set_draw_color(200, 205, 210)
            pdf.set_line_width(0.25)
            
            # Dibujar la celda
            pdf.multi_cell(widths[i], row_h, text, border=1, align=align, fill=True)
            
        # Posicionarse al final de la fila
        pdf.set_xy(x_start, y_start + row_h)
    
    pdf.ln(4)

def parse_markdown_to_pdf(markdown_path, output_pdf_path):
    filename = os.path.basename(markdown_path).lower()
    is_client_guide = "cliente" in filename or "mandante" in filename
    
    title_header = "VIKAR GPS  |  Guía de Integración para Mandantes" if is_client_guide else "VIKAR GPS  |  Manual de Operación de Integraciones B2B"

    with open(markdown_path, "r", encoding="utf-8") as f:
        content = f.read()

    pdf = ProfessionalPDF(title_header=title_header)
    pdf.add_page()
    
    # ------------------ PORTADA (COVER PAGE) ------------------
    pdf.in_cover = True
    
    # Banda superior decorativa en Azul Vikar
    pdf.set_fill_color(27, 54, 93)
    pdf.rect(0, 0, 210, 40, style="F")
    
    # Título del manual
    pdf.set_xy(20, 50)
    pdf.set_text_color(27, 54, 93)
    pdf.set_font("Arial", "B", 18)
    
    if is_client_guide:
        pdf.multi_cell(170, 8, "GUÍA DE INTEGRACIÓN TELEMÁTICA\nPARA EMPRESAS MANDANTES", align="L")
        pdf.ln(5)
        pdf.set_text_color(100, 110, 120)
        pdf.set_font("Arial", "B", 12)
        pdf.cell(0, 8, "Requerimientos, Tareas y Especificaciones de Transmisión")
    else:
        pdf.multi_cell(170, 7.5, "MANUAL DE CONFIGURACIÓN Y OPERACIÓN:\nINTEGRACIONES TELEMÁTICAS B2B", align="L")
        pdf.ln(5)
        pdf.set_text_color(100, 110, 120)
        pdf.set_font("Arial", "B", 12)
        pdf.cell(0, 8, "VIKAR GPS - Middleware de Enrutamiento en la Nube")
        
    pdf.ln(8)
    
    # Separador
    pdf.set_draw_color(27, 54, 93)
    pdf.set_line_width(1)
    pdf.line(20, pdf.y, 190, pdf.y)
    pdf.ln(12)
    
    # Cuadro de Metadatos
    pdf.set_fill_color(248, 250, 252)
    pdf.set_draw_color(218, 228, 238)
    pdf.set_line_width(0.4)
    pdf.rect(20, pdf.y, 170, 68, style="FD")
    
    metadata_y = pdf.y
    pdf.set_xy(25, metadata_y + 4)
    pdf.set_text_color(40, 40, 40)
    
    if is_client_guide:
        metadata = [
            ("Documento Ref.:", "GI-MAND-01 (Guía de Transmisión Externa)"),
            ("Emisor Oficial:", "Area de Integraciones y TI - Vikar GPS"),
            ("Contacto Técnico:", "contacto@vikargps.cl"),
            ("Alcance:", "Integración de flota proveedora contratada"),
            ("Formatos Soportados:", "API REST (JSON)  |  Web Services SOAP (XML)"),
            ("Estado del Servicio:", "Middleware Activo y Homologado en Producción"),
        ]
    else:
        metadata = [
            ("Version del Manual:", "2.0 (Edicion Corporativa de Oficina)"),
            ("Fecha de Edicion:", "Mayo 2026"),
            ("Disenado Para:", "Operadores, Administradores y Soporte Vikar GPS"),
            ("Servicio Servidor:", "Render Web Service (integraciones-vikar)"),
            ("URL de Acceso Dashboard:", "https://integraciones-vikar.onrender.com"),
            ("Credenciales de Oficina:", "Usuario: admin  |  Contrasena: vikar1247"),
        ]
    
    for label, val in metadata:
        pdf.set_font("Arial", "B", 9.5)
        pdf.cell(50, 9, label)
        pdf.set_font("Arial", "", 9.5)
        pdf.cell(110, 9, val)
        pdf.ln(9)
        pdf.set_x(25)
        
    # Mensaje de impresión en la parte inferior
    pdf.set_xy(20, 220)
    if is_client_guide:
        pdf.set_fill_color(240, 248, 255) # Celeste
        pdf.set_draw_color(190, 218, 255)
        pdf.rect(20, 220, 170, 20, style="FD")
        pdf.set_xy(25, 223)
        pdf.set_text_color(0, 80, 160)
        pdf.set_font("Arial", "B", 9)
        pdf.cell(0, 5, "DOCUMENTO INFORMATIVO EXTERNO")
        pdf.ln(5)
        pdf.set_x(25)
        pdf.set_font("Arial", "", 8.5)
        pdf.cell(0, 5, "Por favor remita este documento a su departamento de TI o de Soporte de Integraciones.")
    else:
        pdf.set_fill_color(255, 241, 240) # Rojo
        pdf.set_draw_color(255, 204, 199)
        pdf.rect(20, 220, 170, 20, style="FD")
        pdf.set_xy(25, 223)
        pdf.set_text_color(160, 40, 40)
        pdf.set_font("Arial", "B", 9)
        pdf.cell(0, 5, "DOCUMENTO OFICIAL DE USO INTERNO")
        pdf.ln(5)
        pdf.set_x(25)
        pdf.set_font("Arial", "", 8.5)
        pdf.cell(0, 5, "Por favor mantenga este manual cerca de la central de monitoreo para referencia rapida.")
    
    pdf.ln(5)
    pdf.in_cover = False
    pdf.add_page()
    
    # ------------------ PARSEO DE LÍNEAS ------------------
    lines = content.split("\n")
    
    # Saltar la cabecera original del markdown hasta el índice
    idx_start = 0
    for i, line in enumerate(lines):
        if "## 📋 ÍNDICE DE CONTENIDOS" in line or "## ÍNDICE DE CONTENIDOS" in line:
            idx_start = i
            break
            
    if idx_start == 0:
        idx_start = 6  # Fallback
        
    in_code = False
    in_table = False
    in_blockquote = False
    
    code_lines = []
    table_lines = []
    blockquote_lines = []
    blockquote_type = "NOTE"
    
    i = idx_start
    while i < len(lines):
        line = lines[i]
        
        # Detectar saltos de página explícitos en Markdown
        if "\\newpage" in line or "<div style=\"page-break-after: always;\">" in line:
            pdf.add_page()
            i += 1
            continue

        # --- BLOQUES DE CÓDIGO ---
        if line.strip().startswith("```"):
            if in_code:
                draw_code_block(pdf, code_lines)
                code_lines = []
                in_code = False
            else:
                in_code = True
            i += 1
            continue
            
        if in_code:
            code_lines.append(line)
            i += 1
            continue

        # --- TABLAS ---
        if line.strip().startswith("|"):
            in_table = True
            table_lines.append(line)
            i += 1
            continue
        elif in_table:
            draw_table(pdf, table_lines)
            table_lines = []
            in_table = False

        # --- CITAS / ALERTAS ---
        if line.strip().startswith(">"):
            in_blockquote = True
            if "[!WARNING]" in line or "[!CAUTION]" in line:
                blockquote_type = "WARNING"
            elif "[!NOTE]" in line or "[!TIP]" in line or "[!IMPORTANT]" in line:
                blockquote_type = "NOTE"
            blockquote_lines.append(line)
            i += 1
            continue
        elif in_blockquote:
            draw_alert_box(pdf, blockquote_type, blockquote_lines)
            blockquote_lines = []
            in_blockquote = False
            blockquote_type = "NOTE"

        # --- ENCABEZADOS (HEADINGS) ---
        # H1
        if line.startswith("# ") and not line.startswith("##"):
            title_text = clean_special_chars(line[2:].strip())
            pdf.set_font("Arial", "B", 15)
            pdf.set_text_color(27, 54, 93) # Azul Vikar
            pdf.ln(6)
            pdf.cell(0, 8, title_text)
            pdf.ln(8)
            pdf.set_draw_color(27, 54, 93)
            pdf.set_line_width(0.6)
            pdf.line(20, pdf.y, 190, pdf.y)
            pdf.ln(4)
            i += 1
            continue

        # H2
        if line.startswith("## "):
            title_text = clean_special_chars(line[3:].strip())
            if pdf.y > 235:
                pdf.add_page()
            pdf.set_font("Arial", "B", 12.5)
            pdf.set_text_color(27, 54, 93) # Azul Vikar
            pdf.ln(5)
            pdf.cell(0, 8, title_text)
            pdf.ln(8)
            pdf.set_draw_color(180, 190, 200)
            pdf.set_line_width(0.3)
            pdf.line(20, pdf.y, 190, pdf.y)
            pdf.ln(4)
            i += 1
            continue
            
        # H3
        if line.startswith("### "):
            title_text = clean_special_chars(line[4:].strip())
            if pdf.y > 240:
                pdf.add_page()
            pdf.set_font("Arial", "B", 10.5)
            pdf.set_text_color(60, 70, 80)
            pdf.ln(3)
            pdf.cell(0, 7, title_text)
            pdf.ln(8.5)
            i += 1
            continue

        # H4
        if line.startswith("#### "):
            title_text = clean_special_chars(line[5:].strip())
            pdf.set_font("Arial", "B", 9.5)
            pdf.set_text_color(80, 85, 90)
            pdf.ln(2)
            pdf.cell(0, 6, title_text)
            pdf.ln(7)
            i += 1
            continue

        # --- SEPARADORES ---
        if line.strip() == "---":
            pdf.ln(3)
            pdf.set_draw_color(220, 225, 230)
            pdf.set_line_width(0.2)
            pdf.line(20, pdf.y, 190, pdf.y)
            pdf.ln(3)
            i += 1
            continue

        # --- LISTAS (BULLET POINTS & CHECKBOXES) ---
        bullet_match = re.match(r'^(\s*)[*\-]\s+(.*)$', line)
        if bullet_match:
            indentation = len(bullet_match.group(1))
            level = indentation // 2
            list_content = bullet_match.group(2).strip()
            
            checkbox_match = re.match(r'^\[([ xX])\]\s*(.*)$', list_content)
            if checkbox_match:
                is_checked = checkbox_match.group(1).lower() == 'x'
                text_content = checkbox_match.group(2).strip()
                draw_list_item(pdf, text_content, is_checkbox=True, is_checked=is_checked, level=level)
            else:
                draw_list_item(pdf, list_content, is_checkbox=False, is_checked=False, level=level)
            i += 1
            continue

        # --- PÁRRAFOS Y TEXTO PLANO ---
        cleaned_line = line.strip()
        if cleaned_line:
            if "_____" in cleaned_line:
                pdf.set_font("Arial", "", 9.5)
                pdf.set_text_color(50, 50, 50)
                print_formatted_text(pdf, cleaned_line, font_size=9.5, line_height=6.5)
                pdf.ln(2)
            else:
                pdf.set_x(20)
                print_formatted_text(pdf, cleaned_line, font_size=9.5, line_height=5.2)
                pdf.ln(5)
        else:
            pdf.ln(2)

        i += 1
        
    pdf.output(output_pdf_path)
    print(f"PDF generado exitosamente en: {output_pdf_path}")

def draw_list_item(pdf, text, is_checkbox=False, is_checked=False, level=0):
    indent = 5 + level * 5
    pdf.set_x(20 + indent)
    
    start_x = pdf.x
    start_y = pdf.y
    
    pdf.set_font("Arial", "", 9.5)
    pdf.set_text_color(40, 40, 40)
    
    if is_checkbox:
        pdf.set_draw_color(100, 110, 120)
        pdf.set_line_width(0.3)
        pdf.rect(start_x, start_y + 1, 3.2, 3.2, style="D")
        if is_checked:
            pdf.set_fill_color(27, 54, 93)
            pdf.rect(start_x + 0.6, start_y + 1.6, 2, 2, style="F")
        pdf.set_xy(start_x + 5.5, start_y)
    else:
        pdf.set_fill_color(80, 90, 100)
        pdf.ellipse(start_x + 1, start_y + 1.8, 1.4, 1.4, style="F")
        pdf.set_xy(start_x + 5.5, start_y)
        
    print_formatted_text(pdf, text, font_size=9.5, line_height=5.2)
    pdf.ln(5.2)

if __name__ == "__main__":
    md_path = r"C:\Users\aaron\.gemini\antigravity\brain\ffe6c5ae-7b79-4366-b536-88a2175e3fad\manual_integraciones_b2b.md"
    desktop_path = r"C:\Users\aaron\OneDrive\Desktop\Manual_Integraciones_B2B.pdf"
    
    if len(sys.argv) > 1:
        md_path = sys.argv[1]
    if len(sys.argv) > 2:
        desktop_path = sys.argv[2]
        
    parse_markdown_to_pdf(md_path, desktop_path)
