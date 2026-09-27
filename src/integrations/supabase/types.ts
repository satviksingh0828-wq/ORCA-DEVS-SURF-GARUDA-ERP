export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      app_settings: {
        Row: {
          id: string;
          theme: string;
          login_ui: string;
          background_video_enabled: boolean;
          background_video_url: string;
          glass_surface_opacity: number;
          glass_background_veil: number;
          glass_text_color: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          theme?: string;
          login_ui?: string;
          background_video_enabled?: boolean;
          background_video_url?: string;
          glass_surface_opacity?: number;
          glass_background_veil?: number;
          glass_text_color?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          theme?: string;
          login_ui?: string;
          background_video_enabled?: boolean;
          background_video_url?: string;
          glass_surface_opacity?: number;
          glass_background_veil?: number;
          glass_text_color?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      app_users: {
        Row: {
          id: string;
          username: string;
          password: string;
          full_name: string;
          role: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          username: string;
          password: string;
          full_name?: string;
          role?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          password?: string;
          full_name?: string;
          role?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      branches: {
        Row: {
          address_line1: string | null;
          address_line2: string | null;
          area_locality: string | null;
          branch_email: string | null;
          branch_name: string;
          branch_phone: string | null;
          branch_type: string | null;
          city: string | null;
          country: string | null;
          created_at: string;
          district: string | null;
          email_address: string | null;
          gstin: string | null;
          id: string;
          landmark: string | null;
          manager_designation: string | null;
          manager_email: string | null;
          manager_mobile: string | null;
          manager_name: string | null;
          mobile_number: string | null;
          pan: string | null;
          pin_code: string | null;
          state: string | null;
          state_code: string | null;
          updated_at: string;
        };
        Insert: {
          address_line1?: string | null;
          address_line2?: string | null;
          area_locality?: string | null;
          branch_email?: string | null;
          branch_name: string;
          branch_phone?: string | null;
          branch_type?: string | null;
          city?: string | null;
          country?: string | null;
          created_at?: string;
          district?: string | null;
          email_address?: string | null;
          gstin?: string | null;
          id?: string;
          landmark?: string | null;
          manager_designation?: string | null;
          manager_email?: string | null;
          manager_mobile?: string | null;
          manager_name?: string | null;
          mobile_number?: string | null;
          pan?: string | null;
          pin_code?: string | null;
          state?: string | null;
          state_code?: string | null;
          updated_at?: string;
        };
        Update: {
          address_line1?: string | null;
          address_line2?: string | null;
          area_locality?: string | null;
          branch_email?: string | null;
          branch_name?: string;
          branch_phone?: string | null;
          branch_type?: string | null;
          city?: string | null;
          country?: string | null;
          created_at?: string;
          district?: string | null;
          email_address?: string | null;
          gstin?: string | null;
          id?: string;
          landmark?: string | null;
          manager_designation?: string | null;
          manager_email?: string | null;
          manager_mobile?: string | null;
          manager_name?: string | null;
          mobile_number?: string | null;
          pan?: string | null;
          pin_code?: string | null;
          state?: string | null;
          state_code?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_branch_access: {
        Row: {
          id: string;
          user_id: string;
          branch_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          branch_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          branch_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_branch_access_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "app_users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_branch_access_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
        ];
      };
      closed_trips: {
        Row: {
          branch_id: string | null;
          branch_name: string | null;
          closed_at: string;
          created_at: string;
          end_date: string | null;
          id: string;
          net_income: number;
          snapshot: Json;
          start_date: string | null;
          total_expense: number;
          total_income: number;
          trip_code: string;
          updated_at: string;
        };
        Insert: {
          branch_id?: string | null;
          branch_name?: string | null;
          closed_at?: string;
          created_at?: string;
          end_date?: string | null;
          id?: string;
          net_income?: number;
          snapshot?: Json;
          start_date?: string | null;
          total_expense?: number;
          total_income?: number;
          trip_code: string;
          updated_at?: string;
        };
        Update: {
          branch_id?: string | null;
          branch_name?: string | null;
          closed_at?: string;
          created_at?: string;
          end_date?: string | null;
          id?: string;
          net_income?: number;
          snapshot?: Json;
          start_date?: string | null;
          total_expense?: number;
          total_income?: number;
          trip_code?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      company: {
        Row: {
          address_line1: string | null;
          address_line2: string | null;
          cin: string | null;
          city: string | null;
          company_name: string;
          company_type: string | null;
          country: string | null;
          created_at: string;
          email: string | null;
          gstin: string | null;
          id: string;
          iec: string | null;
          industry: string | null;
          legal_business_name: string | null;
          mobile_number: string | null;
          msme_udyam: string | null;
          pan: string | null;
          pin_code: string | null;
          state: string | null;
          tan: string | null;
          telephone_number: string | null;
          transport_license_number: string | null;
          updated_at: string;
          website: string | null;
        };
        Insert: {
          address_line1?: string | null;
          address_line2?: string | null;
          cin?: string | null;
          city?: string | null;
          company_name?: string;
          company_type?: string | null;
          country?: string | null;
          created_at?: string;
          email?: string | null;
          gstin?: string | null;
          id?: string;
          iec?: string | null;
          industry?: string | null;
          legal_business_name?: string | null;
          mobile_number?: string | null;
          msme_udyam?: string | null;
          pan?: string | null;
          pin_code?: string | null;
          state?: string | null;
          tan?: string | null;
          telephone_number?: string | null;
          transport_license_number?: string | null;
          updated_at?: string;
          website?: string | null;
        };
        Update: {
          address_line1?: string | null;
          address_line2?: string | null;
          cin?: string | null;
          city?: string | null;
          company_name?: string;
          company_type?: string | null;
          country?: string | null;
          created_at?: string;
          email?: string | null;
          gstin?: string | null;
          id?: string;
          iec?: string | null;
          industry?: string | null;
          legal_business_name?: string | null;
          mobile_number?: string | null;
          msme_udyam?: string | null;
          pan?: string | null;
          pin_code?: string | null;
          state?: string | null;
          tan?: string | null;
          telephone_number?: string | null;
          transport_license_number?: string | null;
          updated_at?: string;
          website?: string | null;
        };
        Relationships: [];
      };
      contract_entries: {
        Row: {
          contract_id: string;
          created_at: string;
          freight_route_range_type: string;
          freight_route_ranges: Json;
          from_location_id: string | null;
          from_pin_code: string | null;
          id: string;
          loading_route_range_type: string;
          loading_route_ranges: Json;
          monthly_change_amount: string | null;
          monthly_change_note: string | null;
          per_manifest_amount: string | null;
          per_manifest_note: string | null;
          to_location_id: string | null;
          to_pin_code: string | null;
          updated_at: string;
          yearly_change_amount: string | null;
          yearly_change_note: string | null;
        };
        Insert: {
          contract_id: string;
          created_at?: string;
          freight_route_range_type?: string;
          freight_route_ranges?: Json;
          from_location_id?: string | null;
          from_pin_code?: string | null;
          id?: string;
          loading_route_range_type?: string;
          loading_route_ranges?: Json;
          monthly_change_amount?: string | null;
          monthly_change_note?: string | null;
          per_manifest_amount?: string | null;
          per_manifest_note?: string | null;
          to_location_id?: string | null;
          to_pin_code?: string | null;
          updated_at?: string;
          yearly_change_amount?: string | null;
          yearly_change_note?: string | null;
        };
        Update: {
          contract_id?: string;
          created_at?: string;
          freight_route_range_type?: string;
          freight_route_ranges?: Json;
          from_location_id?: string | null;
          from_pin_code?: string | null;
          id?: string;
          loading_route_range_type?: string;
          loading_route_ranges?: Json;
          monthly_change_amount?: string | null;
          monthly_change_note?: string | null;
          per_manifest_amount?: string | null;
          per_manifest_note?: string | null;
          to_location_id?: string | null;
          to_pin_code?: string | null;
          updated_at?: string;
          yearly_change_amount?: string | null;
          yearly_change_note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "contract_entries_contract_id_fkey";
            columns: ["contract_id"];
            isOneToOne: false;
            referencedRelation: "contracts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contract_entries_from_location_id_fkey";
            columns: ["from_location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contract_entries_to_location_id_fkey";
            columns: ["to_location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
        ];
      };
      contracts: {
        Row: {
          address_line1: string | null;
          address_line2: string | null;
          cin: string | null;
          city: string | null;
          company_name: string | null;
          company_type: string | null;
          contract_name: string;
          country: string | null;
          created_at: string;
          email: string | null;
          gstin: string | null;
          id: string;
          iec: string | null;
          industry: string | null;
          legal_business_name: string | null;
          mobile_number: string | null;
          msme_udyam: string | null;
          pan: string | null;
          pin_code: string | null;
          fixed_monthly_charge: number;
          fixed_monthly_charge_note: string;
          fixed_yearly_charge: number;
          fixed_yearly_charge_note: string;
          state: string | null;
          tan: string | null;
          telephone_number: string | null;
          updated_at: string;
          website: string | null;
        };
        Insert: {
          address_line1?: string | null;
          address_line2?: string | null;
          cin?: string | null;
          city?: string | null;
          company_name?: string | null;
          company_type?: string | null;
          contract_name: string;
          country?: string | null;
          created_at?: string;
          email?: string | null;
          fixed_monthly_charge?: number;
          fixed_monthly_charge_note?: string;
          fixed_yearly_charge?: number;
          fixed_yearly_charge_note?: string;
          gstin?: string | null;
          id?: string;
          iec?: string | null;
          industry?: string | null;
          legal_business_name?: string | null;
          mobile_number?: string | null;
          msme_udyam?: string | null;
          pan?: string | null;
          pin_code?: string | null;
          state?: string | null;
          tan?: string | null;
          telephone_number?: string | null;
          updated_at?: string;
          website?: string | null;
        };
        Update: {
          address_line1?: string | null;
          address_line2?: string | null;
          cin?: string | null;
          city?: string | null;
          company_name?: string | null;
          company_type?: string | null;
          contract_name?: string;
          country?: string | null;
          created_at?: string;
          email?: string | null;
          fixed_monthly_charge?: number;
          fixed_monthly_charge_note?: string;
          fixed_yearly_charge?: number;
          fixed_yearly_charge_note?: string;
          gstin?: string | null;
          id?: string;
          iec?: string | null;
          industry?: string | null;
          legal_business_name?: string | null;
          mobile_number?: string | null;
          msme_udyam?: string | null;
          pan?: string | null;
          pin_code?: string | null;
          state?: string | null;
          tan?: string | null;
          telephone_number?: string | null;
          updated_at?: string;
          website?: string | null;
        };
        Relationships: [];
      };
      drivers: {
        Row: {
          aadhaar_photo_path: string | null;
          aadhaar_number: string | null;
          alternate_mobile: string | null;
          bank_account_holder: string | null;
          bank_account_number: string | null;
          bank_branch: string | null;
          bank_ifsc: string | null;
          bank_name: string | null;
          blood_group: string | null;
          branch_id: string | null;
          created_at: string;
          curr_address_line1: string | null;
          curr_address_line2: string | null;
          curr_city: string | null;
          curr_country: string | null;
          curr_pin_code: string | null;
          curr_same_as_perm: string | null;
          curr_state: string | null;
          date_of_birth: string | null;
          driver_code: string;
          driver_photo_path: string | null;
          email: string | null;
          emergency_contact_name: string | null;
          emergency_contact_number: string | null;
          emergency_contact_relationship: string | null;
          full_name: string;
          gender: string | null;
          guardian_name: string | null;
          id: string;
          joining_date: string | null;
          ending_date: string | null;
          licence_authority: string | null;
          licence_expiry_date: string | null;
          licence_issue_date: string | null;
          licence_number: string | null;
          licence_photo_path: string | null;
          licence_type: string | null;
          marital_status: string | null;
          mobile_number: string | null;
          pan_number: string | null;
          perm_address_line1: string | null;
          perm_address_line2: string | null;
          perm_city: string | null;
          perm_country: string | null;
          perm_pin_code: string | null;
          perm_state: string | null;
          salary_amount: string | null;
          salary_type: string | null;
          updated_at: string;
          upi_id: string | null;
        };
        Insert: {
          aadhaar_photo_path?: string | null;
          aadhaar_number?: string | null;
          alternate_mobile?: string | null;
          bank_account_holder?: string | null;
          bank_account_number?: string | null;
          bank_branch?: string | null;
          bank_ifsc?: string | null;
          bank_name?: string | null;
          blood_group?: string | null;
          branch_id?: string | null;
          created_at?: string;
          curr_address_line1?: string | null;
          curr_address_line2?: string | null;
          curr_city?: string | null;
          curr_country?: string | null;
          curr_pin_code?: string | null;
          curr_same_as_perm?: string | null;
          curr_state?: string | null;
          date_of_birth?: string | null;
          driver_code: string;
          driver_photo_path?: string | null;
          email?: string | null;
          emergency_contact_name?: string | null;
          emergency_contact_number?: string | null;
          emergency_contact_relationship?: string | null;
          full_name: string;
          gender?: string | null;
          guardian_name?: string | null;
          id?: string;
          joining_date?: string | null;
          ending_date?: string | null;
          licence_authority?: string | null;
          licence_expiry_date?: string | null;
          licence_issue_date?: string | null;
          licence_number?: string | null;
          licence_photo_path?: string | null;
          licence_type?: string | null;
          marital_status?: string | null;
          mobile_number?: string | null;
          pan_number?: string | null;
          perm_address_line1?: string | null;
          perm_address_line2?: string | null;
          perm_city?: string | null;
          perm_country?: string | null;
          perm_pin_code?: string | null;
          perm_state?: string | null;
          salary_amount?: string | null;
          salary_type?: string | null;
          updated_at?: string;
          upi_id?: string | null;
        };
        Update: {
          aadhaar_photo_path?: string | null;
          aadhaar_number?: string | null;
          alternate_mobile?: string | null;
          bank_account_holder?: string | null;
          bank_account_number?: string | null;
          bank_branch?: string | null;
          bank_ifsc?: string | null;
          bank_name?: string | null;
          blood_group?: string | null;
          branch_id?: string | null;
          created_at?: string;
          curr_address_line1?: string | null;
          curr_address_line2?: string | null;
          curr_city?: string | null;
          curr_country?: string | null;
          curr_pin_code?: string | null;
          curr_same_as_perm?: string | null;
          curr_state?: string | null;
          date_of_birth?: string | null;
          driver_code?: string;
          driver_photo_path?: string | null;
          email?: string | null;
          emergency_contact_name?: string | null;
          emergency_contact_number?: string | null;
          emergency_contact_relationship?: string | null;
          full_name?: string;
          gender?: string | null;
          guardian_name?: string | null;
          id?: string;
          joining_date?: string | null;
          ending_date?: string | null;
          licence_authority?: string | null;
          licence_expiry_date?: string | null;
          licence_issue_date?: string | null;
          licence_number?: string | null;
          licence_photo_path?: string | null;
          licence_type?: string | null;
          marital_status?: string | null;
          mobile_number?: string | null;
          pan_number?: string | null;
          perm_address_line1?: string | null;
          perm_address_line2?: string | null;
          perm_city?: string | null;
          perm_country?: string | null;
          perm_pin_code?: string | null;
          perm_state?: string | null;
          salary_amount?: string | null;
          salary_type?: string | null;
          updated_at?: string;
          upi_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "drivers_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
        ];
      };
      driver_advance_deductions: {
        Row: {
          id: string;
          advance_id: string;
          driver_id: string;
          payroll_id: string | null;
          month: string;
          deduction_amount: number;
          is_applied: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          advance_id: string;
          driver_id: string;
          payroll_id?: string | null;
          month: string;
          deduction_amount: number;
          is_applied?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          advance_id?: string;
          driver_id?: string;
          payroll_id?: string | null;
          month?: string;
          deduction_amount?: number;
          is_applied?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "driver_advance_deductions_advance_id_fkey";
            columns: ["advance_id"];
            isOneToOne: false;
            referencedRelation: "driver_advances";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_advance_deductions_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
        ];
      };
      fastag_transactions: {
        Row: {
          amount: number;
          created_at: string;
          id: string;
          note: string | null;
          transaction_date: string;
          transaction_type: string;
          trip_code: string | null;
          updated_at: string;
          vehicle_id: string;
        };
        Insert: {
          amount?: number;
          created_at?: string;
          id?: string;
          note?: string | null;
          transaction_date: string;
          transaction_type: string;
          trip_code?: string | null;
          updated_at?: string;
          vehicle_id: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          id?: string;
          note?: string | null;
          transaction_date?: string;
          transaction_type?: string;
          trip_code?: string | null;
          updated_at?: string;
          vehicle_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fastag_transactions_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
        ];
      };
      driver_advances: {
        Row: {
          id: string;
          driver_id: string;
          branch_id: string | null;
          amount: number;
          remaining_balance: number;
          payment_date: string;
          monthly_deduction: number;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          driver_id: string;
          branch_id?: string | null;
          amount: number;
          remaining_balance: number;
          payment_date: string;
          monthly_deduction: number;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          driver_id?: string;
          branch_id?: string | null;
          amount?: number;
          remaining_balance?: number;
          payment_date?: string;
          monthly_deduction?: number;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "driver_advances_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
        ];
      };
      driver_payrolls: {
        Row: {
          id: string;
          driver_id: string;
          branch_id: string | null;
          month: string;
          salary_amount: number;
          advance_deduction: number;
          net_amount: number;
          is_paid: boolean;
          paid_date: string | null;
          expenditure_id: string | null;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          driver_id: string;
          branch_id?: string | null;
          month: string;
          salary_amount: number;
          advance_deduction?: number;
          net_amount: number;
          is_paid?: boolean;
          paid_date?: string | null;
          expenditure_id?: string | null;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          driver_id?: string;
          branch_id?: string | null;
          month?: string;
          salary_amount?: number;
          advance_deduction?: number;
          net_amount?: number;
          is_paid?: boolean;
          paid_date?: string | null;
          expenditure_id?: string | null;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "driver_payrolls_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
        ];
      };
      emi_schedules: {
        Row: {
          id: string;
          vehicle_id: string;
          branch_id: string | null;
          loan_amount: number;
          purchase_amount: number | null;
          down_payment: number | null;
          emi_type: string;
          interest_rate: number | null;
          tenure_months: number | null;
          start_date: string | null;
          lender_name: string | null;
          notes: string | null;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          vehicle_id: string;
          branch_id?: string | null;
          loan_amount: number;
          purchase_amount?: number | null;
          down_payment?: number | null;
          emi_type?: string;
          interest_rate?: number | null;
          tenure_months?: number | null;
          start_date?: string | null;
          lender_name?: string | null;
          notes?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          vehicle_id?: string;
          branch_id?: string | null;
          loan_amount?: number;
          purchase_amount?: number | null;
          down_payment?: number | null;
          emi_type?: string;
          interest_rate?: number | null;
          tenure_months?: number | null;
          start_date?: string | null;
          lender_name?: string | null;
          notes?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "emi_schedules_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "emi_schedules_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
        ];
      };
      emi_installments: {
        Row: {
          id: string;
          schedule_id: string;
          installment_number: number;
          due_date: string;
          amount: number;
          principal: number | null;
          interest: number | null;
          is_paid: boolean;
          paid_date: string | null;
          expenditure_id: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          schedule_id: string;
          installment_number: number;
          due_date: string;
          amount: number;
          principal?: number | null;
          interest?: number | null;
          is_paid?: boolean;
          paid_date?: string | null;
          expenditure_id?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          schedule_id?: string;
          installment_number?: number;
          due_date?: string;
          amount?: number;
          principal?: number | null;
          interest?: number | null;
          is_paid?: boolean;
          paid_date?: string | null;
          expenditure_id?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "emi_installments_schedule_id_fkey";
            columns: ["schedule_id"];
            isOneToOne: false;
            referencedRelation: "emi_schedules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "emi_installments_expenditure_id_fkey";
            columns: ["expenditure_id"];
            isOneToOne: false;
            referencedRelation: "expenditures";
            referencedColumns: ["id"];
          },
        ];
      };
      expenditures: {
        Row: {
          amount: string | null;
          branch_id: string | null;
          created_at: string;
          driver_id: string | null;
          entry_date: string | null;
          expenditure_name: string;
          id: string;
          is_emi: boolean;
          emi_installment_id: string | null;
          is_paid: boolean;
          is_payroll: boolean;
          payroll_id: string | null;
          is_yearly_fixed: boolean;
          yearly_fixed_id: string | null;
          yearly_fixed_inst_no: number | null;
          is_insurance: boolean;
          insurance_id: string | null;
          is_road_tax: boolean;
          road_tax_id: string | null;
          is_fastag_recharge: boolean;
          note: string | null;
          paid_date: string | null;
          transporter_id: string | null;
          updated_at: string;
          vehicle_id: string | null;
        };
        Insert: {
          amount?: string | null;
          branch_id?: string | null;
          created_at?: string;
          driver_id?: string | null;
          entry_date?: string | null;
          expenditure_name?: string;
          id?: string;
          is_emi?: boolean;
          emi_installment_id?: string | null;
          is_paid?: boolean;
          is_payroll?: boolean;
          payroll_id?: string | null;
          is_yearly_fixed?: boolean;
          yearly_fixed_id?: string | null;
          yearly_fixed_inst_no?: number | null;
          is_insurance?: boolean;
          insurance_id?: string | null;
          is_road_tax?: boolean;
          road_tax_id?: string | null;
          is_fastag_recharge?: boolean;
          note?: string | null;
          paid_date?: string | null;
          transporter_id?: string | null;
          updated_at?: string;
          vehicle_id?: string | null;
        };
        Update: {
          amount?: string | null;
          branch_id?: string | null;
          created_at?: string;
          driver_id?: string | null;
          entry_date?: string | null;
          expenditure_name?: string;
          id?: string;
          is_emi?: boolean;
          emi_installment_id?: string | null;
          is_paid?: boolean;
          is_payroll?: boolean;
          payroll_id?: string | null;
          is_yearly_fixed?: boolean;
          yearly_fixed_id?: string | null;
          yearly_fixed_inst_no?: number | null;
          is_insurance?: boolean;
          insurance_id?: string | null;
          is_road_tax?: boolean;
          road_tax_id?: string | null;
          is_fastag_recharge?: boolean;
          note?: string | null;
          paid_date?: string | null;
          transporter_id?: string | null;
          updated_at?: string;
          vehicle_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "expenditures_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenditures_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenditures_transporter_id_fkey";
            columns: ["transporter_id"];
            isOneToOne: false;
            referencedRelation: "transporters";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenditures_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
        ];
      };
      vehicle_insurance: {
        Row: {
          id: string;
          vehicle_id: string;
          start_date: string;
          end_date: string;
          start_month: number;
          start_year: number;
          end_month: number;
          end_year: number;
          total_amount: number;
          insurance_number: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          vehicle_id: string;
          start_date: string;
          end_date: string;
          start_month: number;
          start_year: number;
          end_month: number;
          end_year: number;
          total_amount: number;
          insurance_number: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          vehicle_id?: string;
          start_date?: string;
          end_date?: string;
          start_month?: number;
          start_year?: number;
          end_month?: number;
          end_year?: number;
          total_amount?: number;
          insurance_number?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vehicle_insurance_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
        ];
      };
      vehicle_road_tax: {
        Row: {
          id: string;
          vehicle_id: string;
          start_date: string;
          end_date: string;
          start_month: number;
          start_year: number;
          end_month: number;
          end_year: number;
          total_amount: number;
          state: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          vehicle_id: string;
          start_date: string;
          end_date: string;
          start_month: number;
          start_year: number;
          end_month: number;
          end_year: number;
          total_amount: number;
          state: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          vehicle_id?: string;
          start_date?: string;
          end_date?: string;
          start_month?: number;
          start_year?: number;
          end_month?: number;
          end_year?: number;
          total_amount?: number;
          state?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vehicle_road_tax_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
        ];
      };
      user_sessions: {
        Row: {
          user_id: string;
          session_token: string;
          created_at: string;
          last_seen_at: string;
        };
        Insert: {
          user_id: string;
          session_token: string;
          created_at?: string;
          last_seen_at?: string;
        };
        Update: {
          user_id?: string;
          session_token?: string;
          created_at?: string;
          last_seen_at?: string;
        };
        Relationships: [];
      };
      incomes: {
        Row: {
          amount: string | null;
          branch_id: string | null;
          created_at: string;
          driver_id: string | null;
          entry_date: string | null;
          id: string;
          income_name: string;
          is_received: boolean;
          note: string | null;
          received_date: string | null;
          transporter_id: string | null;
          updated_at: string;
          vehicle_id: string | null;
        };
        Insert: {
          amount?: string | null;
          branch_id?: string | null;
          created_at?: string;
          driver_id?: string | null;
          entry_date?: string | null;
          id?: string;
          income_name?: string;
          is_received?: boolean;
          note?: string | null;
          received_date?: string | null;
          transporter_id?: string | null;
          updated_at?: string;
          vehicle_id?: string | null;
        };
        Update: {
          amount?: string | null;
          branch_id?: string | null;
          created_at?: string;
          driver_id?: string | null;
          entry_date?: string | null;
          id?: string;
          income_name?: string;
          is_received?: boolean;
          note?: string | null;
          received_date?: string | null;
          transporter_id?: string | null;
          updated_at?: string;
          vehicle_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "incomes_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incomes_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incomes_transporter_id_fkey";
            columns: ["transporter_id"];
            isOneToOne: false;
            referencedRelation: "transporters";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incomes_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
        ];
      };
      locations: {
        Row: {
          city: string | null;
          country: string | null;
          created_at: string;
          district: string | null;
          id: string;
          location_name: string;
          location_type: string | null;
          pin_code: string | null;
          state: string | null;
          updated_at: string;
        };
        Insert: {
          city?: string | null;
          country?: string | null;
          created_at?: string;
          district?: string | null;
          id?: string;
          location_name: string;
          location_type?: string | null;
          pin_code?: string | null;
          state?: string | null;
          updated_at?: string;
        };
        Update: {
          city?: string | null;
          country?: string | null;
          created_at?: string;
          district?: string | null;
          id?: string;
          location_name?: string;
          location_type?: string | null;
          pin_code?: string | null;
          state?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      transporters: {
        Row: {
          address_line1: string | null;
          address_line2: string | null;
          alternate_mobile: string | null;
          bank_account_holder: string | null;
          bank_account_number: string | null;
          bank_branch: string | null;
          bank_ifsc: string | null;
          bank_name: string | null;
          branch_id: string | null;
          city: string | null;
          country: string | null;
          created_at: string;
          email: string | null;
          gstin: string | null;
          id: string;
          legal_business_name: string | null;
          mobile_number: string | null;
          msme_udyam: string | null;
          pan: string | null;
          pin_code: string | null;
          primary_contact_designation: string | null;
          primary_contact_name: string | null;
          state: string | null;
          tan: string | null;
          telephone: string | null;
          transporter_name: string;
          transporter_type: string | null;
          updated_at: string;
          upi_id: string | null;
          website: string | null;
        };
        Insert: {
          address_line1?: string | null;
          address_line2?: string | null;
          alternate_mobile?: string | null;
          bank_account_holder?: string | null;
          bank_account_number?: string | null;
          bank_branch?: string | null;
          bank_ifsc?: string | null;
          bank_name?: string | null;
          branch_id?: string | null;
          city?: string | null;
          country?: string | null;
          created_at?: string;
          email?: string | null;
          gstin?: string | null;
          id?: string;
          legal_business_name?: string | null;
          mobile_number?: string | null;
          msme_udyam?: string | null;
          pan?: string | null;
          pin_code?: string | null;
          primary_contact_designation?: string | null;
          primary_contact_name?: string | null;
          state?: string | null;
          tan?: string | null;
          telephone?: string | null;
          transporter_name: string;
          transporter_type?: string | null;
          updated_at?: string;
          upi_id?: string | null;
          website?: string | null;
        };
        Update: {
          address_line1?: string | null;
          address_line2?: string | null;
          alternate_mobile?: string | null;
          bank_account_holder?: string | null;
          bank_account_number?: string | null;
          bank_branch?: string | null;
          bank_ifsc?: string | null;
          bank_name?: string | null;
          branch_id?: string | null;
          city?: string | null;
          country?: string | null;
          created_at?: string;
          email?: string | null;
          gstin?: string | null;
          id?: string;
          legal_business_name?: string | null;
          mobile_number?: string | null;
          msme_udyam?: string | null;
          pan?: string | null;
          pin_code?: string | null;
          primary_contact_designation?: string | null;
          primary_contact_name?: string | null;
          state?: string | null;
          tan?: string | null;
          telephone?: string | null;
          transporter_name?: string;
          transporter_type?: string | null;
          updated_at?: string;
          upi_id?: string | null;
          website?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "transporters_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
        ];
      };
      trip_expenses: {
        Row: {
          amount: string | null;
          created_at: string;
          expense_name: string;
          id: string;
          note: string | null;
          sort_order: number;
          trip_id: string;
          updated_at: string;
        };
        Insert: {
          amount?: string | null;
          created_at?: string;
          expense_name?: string;
          id?: string;
          note?: string | null;
          sort_order?: number;
          trip_id: string;
          updated_at?: string;
        };
        Update: {
          amount?: string | null;
          created_at?: string;
          expense_name?: string;
          id?: string;
          note?: string | null;
          sort_order?: number;
          trip_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trip_expenses_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
        ];
      };
      trip_manifests: {
        Row: {
          created_at: string;
          from_location_id: string | null;
          from_pin_code: string | null;
          id: string;
          manifest_number: string;
          manifest_date: string | null;
          quantity: string | null;
          to_location_id: string | null;
          to_pin_code: string | null;
          trip_id: string;
          updated_at: string;
          weight_kg: string | null;
        };
        Insert: {
          created_at?: string;
          from_location_id?: string | null;
          from_pin_code?: string | null;
          id?: string;
          manifest_number?: string;
          manifest_date?: string | null;
          quantity?: string | null;
          to_location_id?: string | null;
          to_pin_code?: string | null;
          trip_id: string;
          updated_at?: string;
          weight_kg?: string | null;
        };
        Update: {
          created_at?: string;
          from_location_id?: string | null;
          from_pin_code?: string | null;
          id?: string;
          manifest_number?: string;
          manifest_date?: string | null;
          quantity?: string | null;
          to_location_id?: string | null;
          to_pin_code?: string | null;
          trip_id?: string;
          updated_at?: string;
          weight_kg?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "trip_manifests_from_location_id_fkey";
            columns: ["from_location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trip_manifests_to_location_id_fkey";
            columns: ["to_location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trip_manifests_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
        ];
      };
      trip_other_income: {
        Row: {
          amount: string | null;
          created_at: string;
          id: string;
          income_name: string;
          note: string | null;
          trip_id: string;
          updated_at: string;
        };
        Insert: {
          amount?: string | null;
          created_at?: string;
          id?: string;
          income_name?: string;
          note?: string | null;
          trip_id: string;
          updated_at?: string;
        };
        Update: {
          amount?: string | null;
          created_at?: string;
          id?: string;
          income_name?: string;
          note?: string | null;
          trip_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trip_other_income_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
        ];
      };
      trips: {
        Row: {
          branch_id: string | null;
          contract_id: string | null;
          created_at: string;
          driver_id: string | null;
          end_date: string | null;
          end_location_id: string | null;
          end_time: string | null;
          id: string;
          notes: string | null;
          odometer_end: string | null;
          odometer_start: string | null;
          ownership: string;
          reopened_at: string | null;
          start_date: string | null;
          start_location_id: string | null;
          start_time: string | null;
          transporter_id: string | null;
          trip_code: string;
          updated_at: string;
          vehicle_id: string | null;
        };
        Insert: {
          branch_id?: string | null;
          contract_id?: string | null;
          created_at?: string;
          driver_id?: string | null;
          end_date?: string | null;
          end_location_id?: string | null;
          end_time?: string | null;
          id?: string;
          notes?: string | null;
          odometer_end?: string | null;
          odometer_start?: string | null;
          ownership?: string;
          reopened_at?: string | null;
          start_date?: string | null;
          start_location_id?: string | null;
          start_time?: string | null;
          transporter_id?: string | null;
          trip_code: string;
          updated_at?: string;
          vehicle_id?: string | null;
        };
        Update: {
          branch_id?: string | null;
          contract_id?: string | null;
          created_at?: string;
          driver_id?: string | null;
          end_date?: string | null;
          end_location_id?: string | null;
          end_time?: string | null;
          id?: string;
          notes?: string | null;
          odometer_end?: string | null;
          odometer_start?: string | null;
          ownership?: string;
          reopened_at?: string | null;
          start_date?: string | null;
          start_location_id?: string | null;
          start_time?: string | null;
          transporter_id?: string | null;
          trip_code?: string;
          updated_at?: string;
          vehicle_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "trips_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trips_contract_id_fkey";
            columns: ["contract_id"];
            isOneToOne: false;
            referencedRelation: "contracts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trips_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trips_end_location_id_fkey";
            columns: ["end_location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trips_start_location_id_fkey";
            columns: ["start_location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trips_transporter_id_fkey";
            columns: ["transporter_id"];
            isOneToOne: false;
            referencedRelation: "transporters";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trips_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
        ];
      };
      vehicles: {
        Row: {
          branch_id: string | null;
          created_at: string;
          fuel_type: string | null;
          id: string;
          internal_code: string | null;
          manufacturer: string | null;
          model: string | null;
          nickname: string | null;
          payload_capacity_kg: string | null;
          purchase_cost: string | null;
          purchase_date: string | null;
          registration_number: string;
          updated_at: string;
          year_of_manufacture: string | null;
        };
        Insert: {
          branch_id?: string | null;
          created_at?: string;
          fuel_type?: string | null;
          id?: string;
          internal_code?: string | null;
          manufacturer?: string | null;
          model?: string | null;
          nickname?: string | null;
          payload_capacity_kg?: string | null;
          purchase_cost?: string | null;
          purchase_date?: string | null;
          registration_number: string;
          updated_at?: string;
          year_of_manufacture?: string | null;
        };
        Update: {
          branch_id?: string | null;
          created_at?: string;
          fuel_type?: string | null;
          id?: string;
          internal_code?: string | null;
          manufacturer?: string | null;
          model?: string | null;
          nickname?: string | null;
          payload_capacity_kg?: string | null;
          purchase_cost?: string | null;
          purchase_date?: string | null;
          registration_number?: string;
          updated_at?: string;
          year_of_manufacture?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "vehicles_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
        ];
      };
      yearly_fixed_expenses: {
        Row: {
          id: string;
          expense_name: string;
          total_amount: number;
          monthly_amount: number;
          start_date: string;
          end_date: string;
          include_start_month: boolean;
          note: string | null;
          branch_id: string | null;
          vehicle_id: string | null;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          expense_name: string;
          total_amount: number;
          monthly_amount: number;
          start_date: string;
          end_date: string;
          include_start_month?: boolean;
          note?: string | null;
          branch_id?: string | null;
          vehicle_id?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          expense_name?: string;
          total_amount?: number;
          monthly_amount?: number;
          start_date?: string;
          end_date?: string;
          include_start_month?: boolean;
          note?: string | null;
          branch_id?: string | null;
          vehicle_id?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "yearly_fixed_expenses_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "yearly_fixed_expenses_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
