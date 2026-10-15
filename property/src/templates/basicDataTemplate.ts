import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { properCase } from '@/shared/utils/helper';

interface Business {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
}

interface UserData {
  fullName?: string;
  gender?: string;
  nationality?: string;
  marital_status?: string;
  email?: string;
  phone?: string;
  address?: string;
  emergencyName?: string;
  emergencyRelationship?: string;
  emergencyPhone?: string;
  emergencyEmail?: string;
  date?: string;
  remarks?: string;
  businessName: string;
  businessAddress?: string;
  businessPhone?: string;
  businessEmail?: string;
}

export const generateUserData = async (
  user: Partial<UserData>,
  business: Business | null,
): Promise<void> => {
  try {
    if (!business) {
      throw new Error(
        'Business profile not found. Please set up business profile first.',
      );
    }

    const userData: UserData = {
      ...user,
      businessName: business.name,
      businessAddress: business.address,
      businessPhone: business.phone,
      businessEmail: business.email,
    };

    const { uri } = await Print.printToFileAsync({
      html: generateData(userData),
    });

    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: `User Data Form - ${userData.fullName || 'User'}`,
      UTI: 'com.adobe.pdf',
    });
  } catch (error) {
    console.error('Error sharing user data form:', error);
    throw error;
  }
};

const generateData = (user: UserData): string => {
  return `
    <html>
      <head>
        <style>
          body { 
            padding: 40px; 
            font-family: Arial, sans-serif;
            color: #333;
            line-height: 1.2;
            max-width: 800px;
            margin: 0 auto;
          }
          
          h2 {
            text-align: center;
            color: #333;
            border-bottom: 2px solid #333;
            padding-bottom: 10px;
            margin-bottom: 20px;
          }

          h3 {
            text-align: center;
            color: #333;
            border-bottom: 2px solid #333;
            padding-bottom: 10px;
            margin-bottom: 10px;
          }
          
          h4 {
            color: #333;
            margin: 25px 0 15px;
            border-bottom: 1px solid #ddd;
            padding-bottom: 5px;
          }
          
          .row {
            margin-bottom: 10px;
          }
          
          .label {
            font-weight: bold;
            display: inline-block;
            width: 180px;
          }

          .business-header {
            text-align: center;
            margin-bottom: 10px;
          }

          .business-name {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 3px;
          }

          .business-details {
            font-size: 14px;
            color: #666;
          }
          
          .signature-section {
             margin-top: 10px;
             padding-top: 10px;
             border-top: 1px solid #ddd;
           }
           
          .signature-name {
              font-family: 'Brush Script MT', 'Lucida Handwriting', 'Comic Sans MS', cursive;
              font-style: italic;
              font-weight: bold;
              font-size: 18px;
              color: #000;
              text-decoration: none;
              letter-spacing: 2px;
              transform: rotate(-2deg);
              display: inline-block;
            }
          
          .footer {
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid #ddd;
            text-align: center;
            font-size: 10px;
            color: #666;
            line-height: 1.0;
          }
        </style>
      </head>
      <body>
        <div class="business-header">
          <div class="business-name">${user.businessName}</div>
          <div class="business-details">
            ${user.businessAddress || ''}<br>
            Phone: ${user.businessPhone || ''}<br>
            Email: ${user.businessEmail || ''}
          </div>
        </div>

        <h2>PERSONAL DATA FORM</h2>
        
        <h4>Section 1: Personal Information</h4>
        <div class="row">
          <span class="label">Full Name:</span>
          <span>${user.fullName || 'Not provided'}</span>
        </div>
        <div class="row">
          <span class="label">Gender:</span>
          <span>${user.gender ? properCase(user.gender) : 'Not specified'}</span>
        </div>
        <div class="row">
          <span class="label">Nationality:</span>
          <span>${user.nationality || 'Not specified'}</span>
        </div>
        <div class="row">
          <span class="label">Marital Status:</span>
          <span>${
            user.marital_status ? properCase(user.marital_status) : 'Not specified'
          }</span>
        </div>

        <h4>Section 2: Contact Information</h4>
        <div class="row">
          <span class="label">Email Address:</span>
          <span>${user.email || 'Not provided'}</span>
        </div>
        <div class="row">
          <span class="label">Phone Number:</span>
          <span>${user.phone || 'Not provided'}</span>
        </div>
        <div class="row">
          <span class="label">Address:</span>
          <span>${user.address || 'Not provided'}</span>
        </div>

        <h4>Section 3: Emergency Contact</h4>
        <div class="row">
          <span class="label">Contact Name:</span>
          <span>${user.emergencyName || 'Not provided'}</span>
        </div>
        <div class="row">
          <span class="label">Relationship:</span>
          <span>${user.emergencyRelationship || 'Not specified'}</span>
        </div>
        <div class="row">
          <span class="label">Phone Number:</span>
          <span>${user.emergencyPhone || 'Not provided'}</span>
        </div>
        <div class="row">
          <span class="label">Email Address:</span>
          <span>${user.emergencyEmail || 'Not provided'}</span>
        </div>

        <h4>Section 4: Consent</h4>
        <p>I, <strong>${
          user.fullName || 'Not provided'
        }</strong>, consent to the collection and processing of my personal data for the purpose of my tenancy.</p>
        
        <div class="signature-section">
           <div class="row">
             <span class="label">Signature:</span>
             <span class="signature-name">${user.fullName || 'Not provided'}</span>
           </div>
          <div class="row">
            <span class="label">Date:</span>
            <span>${user.date || 'Not provided'}</span>
          </div>
          <div class="row">
            <span class="label">Remarks:</span>
            <span>${user.remarks || 'None'}</span>
          </div>
        </div>

        <div class="footer">
          <p>This is a computer-generated form and does not require a physical signature.</p>
          <p>© ${new Date().getFullYear()} ${user.businessName}. All rights reserved.</p>
        </div>
      </body>
    </html>
  `;
};
